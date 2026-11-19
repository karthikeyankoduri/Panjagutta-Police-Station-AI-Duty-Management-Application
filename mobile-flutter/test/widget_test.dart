import 'dart:io';

import 'package:dutymanagement/api.dart';
import 'package:dutymanagement/chat.dart';
import 'package:dutymanagement/duty_change_form.dart';
import 'package:dutymanagement/location_reporting.dart';
import 'package:dutymanagement/main.dart';
import 'package:dutymanagement/workspace.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  testWidgets('a fresh installation opens the sign-in screen', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    const channel = MethodChannel('dutymanagement/settings');
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (_) async => null,
    );
    await tester.pumpWidget(const DutyApp());
    await tester.pump();
    expect(find.text('Server address'), findsOneWidget);
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Sign in'))
          .onPressed,
      isNotNull,
    );
  });

  testWidgets(
    'staff bottom tabs open the calendar and keep the station header',
    (tester) async {
      final paths = <String>[];
      final api = DutyApi(
        DutyApi.server('https://station.example'),
        client: MockClient((request) async {
          paths.add(request.url.path);
          return http.Response('[]', 200);
        }),
      );
      final location = LocationReporting(api);
      addTearDown(api.close);
      addTearDown(location.dispose);
      await tester.pumpWidget(
        MaterialApp(
          home: Workspace(
            api: api,
            profile: const {
              'staff_id': 1,
              'staff_name': 'Test Officer',
              'role': 'STAFF',
            },
            location: location,
            onLogout: () {},
            modules: Future.value({
              'roster',
              'attendance',
              'tasks',
              'movements',
            }),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Panjagutta Police Station'), findsOneWidget);
      expect(find.byType(Drawer), findsNothing);
      await tester.tap(find.text('Calendar'));
      await tester.pumpAndSettle();
      expect(find.text('My duty diary'), findsOneWidget);
      expect(find.text('Published shift'), findsOneWidget);
      expect(paths, contains('/api/mobile/diary'));
    },
  );

  test('uses the existing API prefix and rejects unsafe server addresses', () {
    expect(
      DutyApi.server('https://station.example/api/').toString(),
      'https://station.example/api',
    );
    expect(
      DutyApi.server('https://station.example').toString(),
      'https://station.example/api',
    );
    expect(
      () => DutyApi.server('https://user@station.example'),
      throwsFormatException,
    );
    expect(
      () => DutyApi.server('https://station.example?redirect=yes'),
      throwsFormatException,
    );
  });

  test(
    'authenticates a location report and handles an expired session',
    () async {
      var expired = 0;
      final client = DutyApi(
        DutyApi.server('https://station.example'),
        client: MockClient((request) async {
          expect(request.url.path, '/api/mobile/location');
          expect(request.method, 'POST');
          expect(request.headers['authorization'], 'Bearer session');
          expect(request.followRedirects, isFalse);
          return http.Response('{"detail":"Session expired"}', 401);
        }),
      )..token = 'session';
      addTearDown(client.close);
      client.onExpired = () => expired++;
      await expectLater(
        client.request(
          '/mobile/location',
          method: 'POST',
          body: {'latitude': 17.4, 'longitude': 78.4},
        ),
        throwsA(isA<ApiException>()),
      );
      expect(expired, 1);
    },
  );

  testWidgets(
    'chat: users get two tabs, superiors get a list and Message everyone',
    (tester) async {
      http.Response reply(http.Request request) {
        final path = request.url.path;
        if (path == '/api/chat/threads') {
          return http.Response(
            '{"can_broadcast":true,"threads":['
            '{"thread_user_id":null,"title":"Station channel","kind":"station","unread":0,"last":null},'
            '{"thread_user_id":7,"title":"Ravi Kumar","subtitle":"T0007 - STAFF","kind":"direct","unread":2,"last":{"body":"On my way"}}]}',
            200,
          );
        }
        return http.Response('{"items":[]}', 200);
      }

      final api = DutyApi(
        DutyApi.server('https://station.example'),
        client: MockClient((request) async => reply(request)),
      )..token = 'session';
      addTearDown(api.close);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatPage(api: api, profile: const {'id': 7, 'role': 'STAFF'}),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Station'), findsOneWidget);
      expect(find.text('Admin / SHO'), findsOneWidget);
      expect(find.text('Message everyone'), findsNothing);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatPage(
              key: const ValueKey('sho'),
              api: api,
              profile: const {'id': 1, 'role': 'SHO'},
            ),
          ),
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump();
      expect(find.text('Message everyone'), findsOneWidget);
      expect(find.text('Ravi Kumar'), findsOneWidget);
      expect(find.text('Station channel'), findsOneWidget);
    },
  );

  testWidgets(
    'chat: receiving messages refreshes the list without a setState error',
    (tester) async {
      final api = DutyApi(
        DutyApi.server('https://station.example'),
        client: MockClient((request) async {
          if (request.url.path == '/api/chat/threads') {
            return http.Response(
              '{"can_broadcast":false,"threads":['
              '{"thread_user_id":null,"title":"Station channel","kind":"station","unread":1,"last":null},'
              '{"thread_user_id":7,"title":"Admin / SHO","kind":"direct","unread":0,"last":null}]}',
              200,
            );
          }
          if (request.url.path == '/api/chat/messages') {
            return http.Response(
              '{"items":[{"id":1,"thread_user_id":null,"kind":"channel","body":"hi","sender_user_id":2,'
              '"sender_name":"Anand","sender_role":"STAFF","mine":false,"created_at":"2026-11-19T08:05:00+00:00"}]}',
              200,
            );
          }
          return http.Response('{"detail":"ok"}', 200);
        }),
      )..token = 'session';
      addTearDown(api.close);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ChatPage(api: api, profile: const {'id': 7, 'role': 'STAFF'}),
          ),
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pump();
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pump();
      expect(find.text('hi'), findsOneWidget);
      // Errors caught by the conversation appear in a red banner (this is what showed on the phone).
      expect(find.textContaining('setState'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'duty change form has every web field and submits a valid payload',
    (tester) async {
      Json? result;
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Scaffold(
              body: Center(
                child: FilledButton(
                  onPressed: () async => result = await showDialog<Json>(
                    context: context,
                    builder: (_) => const DutyChangeDialog(
                      duties: [
                        {
                          'roster_id': 12,
                          'duty_date': '2026-11-20',
                          'shift_name': 'A',
                          'duty_category': 'Patrol',
                        },
                      ],
                      shifts: [
                        {
                          'code': 'A',
                          'start_time': '06:00',
                          'end_time': '14:00',
                        },
                        {
                          'code': 'B',
                          'start_time': '14:00',
                          'end_time': '22:00',
                        },
                      ],
                      dutyCategories: ['Patrol', 'Station Writer'],
                    ),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
      for (final label in [
        'Roster ID *',
        'Current Date *',
        'Current Shift *',
        'Current Duty Category',
        'Requested Shift',
        'Requested Duty Point',
        'Reason for Infeasibility *',
      ]) {
        expect(find.text(label), findsOneWidget, reason: label);
      }
      // Submitting empty shows the required-field errors and returns nothing.
      await tester.tap(find.text('Submit Change Request'));
      await tester.pumpAndSettle();
      expect(find.text('Enter the roster ID'), findsOneWidget);
      expect(find.text('Enter a reason'), findsOneWidget);

      // Pick the published duty from the dropdown: it fills roster, date, shift and duty.
      await tester.tap(find.byType(DropdownButtonFormField<int>));
      await tester.pumpAndSettle();
      await tester.tap(find.textContaining('2026-11-20 · Shift A').last);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.widgetWithText(TextFormField, 'Reason for Infeasibility *'),
        'Court appearance',
      );
      await tester.ensureVisible(find.text('Submit Change Request'));
      await tester.tap(find.text('Submit Change Request'));
      await tester.pumpAndSettle();
      expect(result, {
        'roster_id': 12,
        'current_roster_date': '2026-11-20',
        'current_shift_code': 'A',
        'current_duty_category': 'Patrol',
        'requested_shift_code': 'B',
        'requested_duty_category': null,
        'reason': 'Court appearance',
      });
    },
  );

  test('bundled role rules match the web and backend source', () {
    expect(
      File('assets/access-matrix.json').readAsStringSync(),
      File('../frontend/src/lib/access-matrix.json').readAsStringSync(),
    );
  });
}
