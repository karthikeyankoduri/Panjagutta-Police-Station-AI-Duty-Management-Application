import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api.dart';
import 'location_reporting.dart';
import 'station_style.dart';
import 'workspace.dart';

void main() => runApp(const DutyApp());

class DutyApp extends StatelessWidget {
  const DutyApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Panjagutta Duty Management',
    theme: stationTheme(),
    home: const SessionScreen(),
  );
}

class SessionScreen extends StatefulWidget {
  const SessionScreen({super.key});

  @override
  State<SessionScreen> createState() => _SessionScreenState();
}

class _SessionScreenState extends State<SessionScreen> {
  static const storage = FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  static const sessionKey = 'duty_session';
  final server = TextEditingController(
    text: const String.fromEnvironment('API_BASE_URL'),
  );
  final username = TextEditingController();
  final password = TextEditingController();
  final newPassword = TextEditingController();
  DutyApi? api;
  LocationReporting? location;
  Json? profile;
  bool busy = true;
  bool? connectionExpanded;
  String? connectionStatus;
  String? error;

  @override
  void initState() {
    super.initState();
    unawaited(run(restore));
  }

  Future<void> restore() async {
    final savedServer = await storage.read(key: 'duty_server');
    if (savedServer != null) {
      server.text = savedServer;
    } else {
      try {
        final legacy = await const MethodChannel('dutymanagement/settings')
            .invokeMethod<String>('legacyServer');
        if (legacy != null && legacy.isNotEmpty) server.text = legacy;
      } on MissingPluginException {
        // There are no legacy Android settings on iOS.
      }
    }
    final token = await storage.read(key: sessionKey);
    if (token == null || savedServer == null) return;
    final restored = DutyApi(DutyApi.server(savedServer))..token = token;
    api = restored;
    try {
      await loadProfile(restored);
    } on ApiException catch (error) {
      if (error.status != 401) rethrow;
      await storage.delete(key: sessionKey);
      restored.token = null;
      this.error = 'Session expired. Sign in again.';
    }
  }

  Future<void> loadProfile(DutyApi client) async {
    final result = await client.request('/auth/me') as Json;
    if (!mounted || api != client || client.token == null) return;
    profile = result;
    location ??= LocationReporting(client);
    client.onExpired = () {
      if (mounted && api == client && profile != null) {
        unawaited(run(() => endSession(expired: true)));
      }
    };
  }

  Future<void> signIn() async {
    final client = DutyApi(DutyApi.server(server.text));
    api?.close();
    api = client;
    final login = await client.request(
      '/auth/login',
      method: 'POST',
      body: {'username': username.text.trim(), 'password': password.text},
    ) as Json;
    client.token = login['access_token'] as String;
    await storage.write(key: 'duty_server', value: client.base.toString());
    await storage.write(key: sessionKey, value: client.token);
    password.clear();
    await loadProfile(client);
  }

  Future<void> changePassword() async {
    final client = api!;
    await client.request(
      '/auth/change-password',
      method: 'POST',
      body: {
        'current_password': password.text,
        'new_password': newPassword.text,
      },
    );
    password.clear();
    newPassword.clear();
    await endSession();
    error = 'Password changed. Sign in with your new password.';
  }

  Future<void> endSession({bool expired = false}) async {
    final client = api;
    final tracker = location;
    profile = null;
    location = null;
    client?.onExpired = null;
    final stopping = tracker?.stop();
    if (mounted) setState(() {});
    await stopping;
    tracker?.dispose();
    try {
      await storage.delete(key: sessionKey);
      if (!expired && client?.token != null) {
        await client!.request('/auth/logout', method: 'POST');
      }
    } finally {
      client?.token = null;
    }
    if (expired) error = 'Session expired. Sign in again.';
  }

  Future<void> run(Future<void> Function() action) async {
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (failure) {
      error = switch (failure) {
        ApiException() => failure.message,
        FormatException() => failure.message,
        _ =>
          'Could not complete the request. Check the connection and try again.',
      };
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  void dispose() {
    location?.dispose();
    api?.close();
    server.dispose();
    username.dispose();
    password.dispose();
    newPassword.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = profile;
    final needsPassword = user?['must_change_password'] == true;
    if (user != null && !needsPassword) {
      return Workspace(
        api: api!,
        profile: user,
        location: location!,
        onLogout: () => run(endSession),
        modules: rootBundle.loadString('assets/access-matrix.json').then((
          data,
        ) {
          final matrix = jsonDecode(data) as Json;
          final groups = matrix['groups'] as Json;
          return (matrix['modules'] as List)
              .cast<Json>()
              .where(
                (module) =>
                    (groups[module['group']] as List).contains(user['role']),
              )
              .map((module) => module['id'] as String)
              .toSet();
        }),
      );
    }
    final showConnection = connectionExpanded ?? server.text.trim().isEmpty;
    const pale = Color(0xffa7b7c9);

    Widget field(
      TextEditingController controller,
      String label, {
      bool secret = false,
      TextInputType? type,
      String? autofill,
    }) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: TextField(
        controller: controller,
        enabled: !busy,
        obscureText: secret,
        keyboardType: type,
        autofillHints: autofill == null ? null : [autofill],
        style: const TextStyle(color: Color(0xfff5f8fc)),
        decoration: InputDecoration(
          hintText: label,
          hintStyle: const TextStyle(color: Color(0xffc0c9d5)),
          filled: true,
          fillColor: const Color(0x1cffffff),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 14,
            vertical: 13,
          ),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(9)),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(9),
            borderSide: const BorderSide(color: Color(0x66b1c2d2)),
          ),
        ),
      ),
    );

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: navy,
        body: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(
              'assets/login_background.jpg',
              fit: BoxFit.cover,
              excludeFromSemantics: true,
            ),
            const ColoredBox(color: Color(0x8c08172c)),
            SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) => SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 20,
                  ),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(
                      minHeight: (constraints.maxHeight - 40).clamp(
                        0.0,
                        double.infinity,
                      ),
                    ),
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 440),
                        child: Container(
                          padding: const EdgeInsets.fromLTRB(22, 22, 22, 20),
                          decoration: BoxDecoration(
                            color: const Color(0xee14253c),
                            borderRadius: BorderRadius.circular(14),
                            border: Border.all(color: const Color(0x6685b7e2)),
                          ),
                          child: AutofillGroup(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Image.asset(
                                  crest,
                                  height: 108,
                                  width: 96,
                                  semanticLabel: 'Hyderabad City Police crest',
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'PANJAGUTTA POLICE STATION',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: Color(0xfff7f9fc),
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const Padding(
                                  padding: EdgeInsets.only(top: 4, bottom: 18),
                                  child: Text(
                                    'HYDERABAD CITY POLICE PORTAL',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: pale, fontSize: 11),
                                  ),
                                ),
                                if (needsPassword)
                                  const Padding(
                                    padding: EdgeInsets.only(bottom: 12),
                                    child: Text(
                                      'Change your password',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  )
                                else ...[
                                  if (showConnection) ...[
                                    field(
                                      server,
                                      'Server address',
                                      type: TextInputType.url,
                                    ),
                                    const Text(
                                      'Enter the approved HTTPS API address provided by IT.',
                                      style: TextStyle(
                                        color: pale,
                                        fontSize: 12,
                                      ),
                                    ),
                                    if (connectionStatus != null)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 8),
                                        child: Text(
                                          connectionStatus!,
                                          style: const TextStyle(
                                            color: Color(0xffa7e0be),
                                            fontSize: 12,
                                          ),
                                        ),
                                      ),
                                    const SizedBox(height: 8),
                                    FilledButton(
                                      style: FilledButton.styleFrom(
                                        backgroundColor: const Color(
                                          0xff1769aa,
                                        ),
                                      ),
                                      onPressed: busy
                                          ? null
                                          : () => run(() async {
                                              connectionExpanded = true;
                                              connectionStatus = null;
                                              final client = DutyApi(
                                                DutyApi.server(server.text),
                                              );
                                              connectionStatus =
                                                  'Checking connection…';
                                              try {
                                                await client.request('/health');
                                                connectionStatus = 'API reachable. You can sign in.';
                                              } finally {
                                                client.close();
                                                if (connectionStatus ==
                                                    'Checking connection…') {
                                                  connectionStatus = null;
                                                }
                                              }
                                            }),
                                      child: const Text('Check API connection'),
                                    ),
                                  ],
                                  TextButton(
                                    onPressed: busy
                                        ? null
                                        : () => setState(
                                            () => connectionExpanded =
                                                !showConnection,
                                          ),
                                    child: const Text(
                                      'API CONNECTION SETTINGS',
                                      style: TextStyle(
                                        color: Color(0xff79b9f1),
                                        fontSize: 11,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                  field(
                                    username,
                                    'Staff username',
                                    autofill: AutofillHints.username,
                                  ),
                                ],
                                field(
                                  password,
                                  needsPassword
                                      ? 'Current password'
                                      : 'Password',
                                  secret: true,
                                  autofill: AutofillHints.password,
                                ),
                                if (needsPassword)
                                  field(
                                    newPassword,
                                    'New password',
                                    secret: true,
                                    autofill: AutofillHints.newPassword,
                                  ),
                                if (error != null)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 8),
                                    child: Text(
                                      error!,
                                      style: const TextStyle(
                                        color: Color(0xffffbeba),
                                        fontSize: 12,
                                      ),
                                    ),
                                  ),
                                if (busy) const LinearProgressIndicator(),
                                const SizedBox(height: 8),
                                FilledButton(
                                  onPressed: busy
                                      ? null
                                      : () => run(
                                          needsPassword
                                              ? changePassword
                                              : signIn,
                                        ),
                                  child: Text(
                                    needsPassword ? 'Save password' : 'Sign in',
                                  ),
                                ),
                                if (needsPassword)
                                  TextButton(
                                    onPressed: busy
                                        ? null
                                        : () => run(endSession),
                                    child: const Text(
                                      'Sign out',
                                      style: TextStyle(color: pale),
                                    ),
                                  ),
                                const Padding(
                                  padding: EdgeInsets.only(top: 16),
                                  child: Text(
                                    'STAFF MOBILE ACCESS  ·  AUTHORIZED API REQUIRED',
                                    textAlign: TextAlign.center,
                                    style: TextStyle(color: pale, fontSize: 10),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
