import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api.dart';
import 'chat.dart';
import 'duty_change_form.dart';
import 'location_reporting.dart';
import 'station_style.dart';

class Workspace extends StatefulWidget {
  const Workspace({
    super.key,
    required this.api,
    required this.profile,
    required this.location,
    required this.onLogout,
    required this.modules,
  });

  final DutyApi api;
  final Json profile;
  final LocationReporting location;
  final VoidCallback onLogout;
  final Future<Set<String>> modules;

  @override
  State<Workspace> createState() => _WorkspaceState();
}

class _WorkspaceState extends State<Workspace> with WidgetsBindingObserver {
  String screen = 'home';
  DateTime month = DateTime.now();
  DateTime selectedDay = DateTime.now();
  Timer? timer;
  Future<List<Json>>? data;
  Future<List<List<Json>>>? homeDuties;
  bool updating = false;
  Future<List<Json>>? homeLocations;
  bool showLocations = false;
  final homeScroll = ScrollController();
  final locationsKey = GlobalKey();

  bool get linked => widget.profile['staff_id'] != null;
  bool get staff => widget.profile['role'] == 'STAFF';
  // Live Locations is for Admin SI / Super Admin and sits on the Dashboard (Home).
  bool get canSeeLocations =>
      ['SUPER_ADMIN', 'ADMIN_SI'].contains(widget.profile['role']);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (linked) homeDuties = readHomeDuties();
    startRefresh();
  }

  void startRefresh() {
    timer?.cancel();
    timer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (screen == 'notifications') reload();
      if (screen == 'home' && showLocations) refreshLocations();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      startRefresh();
      if (screen == 'notifications') reload();
      if (screen == 'home' && showLocations) refreshLocations();
    } else if (state == AppLifecycleState.paused) {
      timer?.cancel();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    timer?.cancel();
    homeScroll.dispose();
    super.dispose();
  }

  static const titles = {
    'home': 'Home',
    'roster': 'My published duties',
    'requests': 'Duty change requests',
    'calendar': 'Duty calendar',
    'attendance': 'Today’s attendance',
    'tasks': 'My tasks',
    'movements': 'Outside movements',
    'locations': 'Live Locations',
    'notifications': 'Notifications',
    'profile': 'My profile',
    'more': 'More',
  };

  String date(DateTime value) => value.toIso8601String().split('T').first;

  Future<List<Json>> load() async {
    final first = DateTime(month.year, month.month);
    final last = DateTime(month.year, month.month + 1, 0);
    final path = switch (screen) {
      'roster' => '/mobile/rosters',
      'requests' => '/rosters/change-requests/',
      'calendar' =>
        '/mobile/diary?start_date=${date(first)}&end_date=${date(last)}',
      'attendance' => '/mobile/attendance',
      'tasks' => '/mobile/tasks',
      'movements' => '/mobile/movements',
      'locations' => '/locations/',
      'notifications' => '/notifications/',
      _ => throw StateError('No data source for $screen'),
    };
    return readList(path);
  }

  Future<List<Json>> readList(String path) async {
    final result = await widget.api.request(path);
    return ((result is Json ? result['items'] : result) as List).cast<Json>();
  }

  Future<List<List<Json>>> readHomeDuties() => Future.wait([
    readList('/mobile/attendance'),
    readList('/mobile/rosters'),
  ]);

  void refreshLocations() => setState(() {
    homeLocations = readList('/locations/');
  });

  /// The Live Locations button on the Dashboard reveals the list and scrolls down to it.
  void openLiveLocations() {
    setState(() => showLocations = true);
    refreshLocations();
    scrollToLiveLocations();
  }

  void scrollToLiveLocations() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!homeScroll.hasClients) return;
      // The list builds lazily, so go to the end first to be sure the section exists, then align it.
      homeScroll.jumpTo(homeScroll.position.maxScrollExtent);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final target = locationsKey.currentContext;
        if (target != null) {
          Scrollable.ensureVisible(
            target,
            duration: const Duration(milliseconds: 350),
            curve: Curves.easeOut,
          );
        }
      });
    });
  }

  void select(String next) {
    setState(() {
      screen = next;
      data = ['home', 'profile', 'more'].contains(screen) ? null : load();
    });
  }

  void reload() => setState(() {
    data = load();
  });

  Future<void> update(
    String path, {
    Json? payload,
    String method = 'POST',
  }) async {
    if (updating) return;
    final currentScreen = screen;
    setState(() => updating = true);
    try {
      await widget.api.request(path, method: method, body: payload);
      if (mounted && currentScreen == screen) {
        reload();
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Update saved')));
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              error is ApiException
                  ? error.message
                  : 'Request failed. Check your connection.',
            ),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => updating = false);
    }
  }

  Future<void> newMovement() async {
    final form = GlobalKey<FormState>();
    var purpose = '';
    var destination = '';
    final payload = await showDialog<Json>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('Request outside movement'),
        content: Form(
          key: form,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                decoration: const InputDecoration(labelText: 'Purpose'),
                maxLength: 500,
                onSaved: (value) => purpose = value!.trim(),
                validator: (value) =>
                    value!.trim().isEmpty ? 'Enter a purpose' : null,
              ),
              TextFormField(
                decoration: const InputDecoration(labelText: 'Destination'),
                maxLength: 255,
                onSaved: (value) => destination = value!.trim(),
                validator: (value) =>
                    value!.trim().isEmpty ? 'Enter a destination' : null,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              if (!form.currentState!.validate()) return;
              form.currentState!.save();
              Navigator.pop(dialog, {
                'purpose': purpose,
                'destination': destination,
              });
            },
            child: const Text('Submit'),
          ),
        ],
      ),
    );
    if (mounted && payload != null) {
      await update('/mobile/movements', payload: payload);
    }
  }

  /// Opens the "Submit Duty / Shift Change Request" form (same fields as the web). [duty] pre-fills it
  /// when started from a duty card; the Requests screen opens it empty.
  Future<void> requestDutyChange([Json? duty]) async {
    List<Json> duties = const [];
    var shifts = <Json>[];
    var categories = <String>[];
    try {
      duties = await readList('/mobile/rosters');
    } on Object {
      // The form still works without the list: the officer can type the roster ID.
    }
    try {
      final options = await widget.api.request('/mobile/duty-options') as Json;
      shifts = (options['shifts'] as List).cast<Json>();
      categories = (options['duty_categories'] as List).cast<String>();
    } on Object {
      // Falls back to shifts A/B/C and no duty-point suggestions.
    }
    if (!mounted) return;
    final payload = await showDialog<Json>(
      context: context,
      builder: (dialog) => DutyChangeDialog(
        duties: duties,
        shifts: shifts,
        dutyCategories: categories,
        initial: duty,
      ),
    );
    if (mounted && payload != null) {
      await update('/rosters/change-requests/', payload: payload);
    }
  }

  String get name =>
      (widget.profile['staff_name'] ??
              widget.profile['username'] ??
              'Staff member')
          .toString();

  Widget pageHeading(String label, String title, [String? description]) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: blue,
              fontSize: 10,
              letterSpacing: .8,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            title,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: ink,
            ),
          ),
          if (description != null)
            Text(
              description,
              style: const TextStyle(fontSize: 13, color: muted),
            ),
        ],
      );

  Widget locationCard() {
    final tracker = widget.location;
    return ListenableBuilder(
      listenable: tracker,
      builder: (context, _) => StationCard(
        accent: blue,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'DUTY LOCATION',
              style: TextStyle(
                color: blue,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 6),
            Text(tracker.status),
            if (tracker.lastReportedFix case final fix?)
              Text(
                'Last fix received at ${fix.toLocal().toString().split('.').first}',
                style: const TextStyle(color: muted, fontSize: 12),
              ),
            TextButton(
              onPressed: () =>
                  tracker.active ? tracker.stop() : tracker.start(),
              child: Text(tracker.active ? 'Stop sharing' : 'Start sharing'),
            ),
          ],
        ),
      ),
    );
  }

  Widget home() {
    final profile = widget.profile;
    final now = DateTime.now();
    final greeting = now.hour < 12
        ? 'Good morning'
        : now.hour < 17
        ? 'Good afternoon'
        : 'Good evening';
    return RefreshIndicator(
      onRefresh: () async {
        if (!linked) return;
        final next = readHomeDuties();
        setState(() {
          homeDuties = next;
        });
        await next.then<void>((_) {}, onError: (Object _) {});
      },
      child: ListView(
        controller: homeScroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(20, 18, 20, 18),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [navy, Color(0xff1c3e6c)],
              ),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$greeting,',
                  style: const TextStyle(
                    color: Color(0xffb0c4de),
                    fontSize: 13,
                  ),
                ),
                Text(
                  name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  [
                    profile['designation'] ?? profile['role'],
                    profile['service_number'],
                    profile['sector_name'] ?? 'Station-wide',
                  ].whereType<String>().join('  ·  '),
                  style: const TextStyle(
                    color: gold,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  MaterialLocalizations.of(context).formatFullDate(now),
                  style: const TextStyle(
                    color: Color(0xffb0c4de),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          if (canSeeLocations) ...[
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: openLiveLocations,
              icon: const Icon(Icons.location_on_outlined),
              label: const Text('Live Locations'),
            ),
          ],
          if (linked) ...[
            const SizedBox(height: 12),
            FutureBuilder<List<List<Json>>>(
              future: homeDuties,
              builder: (context, snapshot) {
                final duties = snapshot.data;
                final today = duties?.first.firstOrNull;
                final upcoming = duties == null
                    ? <Json>[]
                    : duties[1]
                          .where((duty) => duty['duty_date'] != date(now))
                          .take(3);
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    StationCard(
                      accent: today == null ? muted : blue,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Expanded(
                                child: Text(
                                  "TODAY'S DUTY",
                                  style: TextStyle(
                                    color: blue,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              if (duties != null)
                                badge(
                                  today == null
                                      ? 'NO SHIFT'
                                      : 'SHIFT ${today['shift_name']}',
                                ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          if (snapshot.hasError)
                            const Text(
                              'Could not load duty details. Pull down to retry.',
                            )
                          else if (duties == null)
                            const LinearProgressIndicator()
                          else
                            Text(
                              today == null
                                  ? 'No published shift assigned today.'
                                  : '${today['duty_category']}',
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          if (today != null)
                            Text(
                              '${today['start_time']} – ${today['end_time']}',
                              style: const TextStyle(
                                color: muted,
                                fontSize: 12,
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (duties != null) ...[
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'UPCOMING SHIFTS',
                              style: TextStyle(
                                fontSize: 10,
                                color: blue,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          TextButton(
                            onPressed: () => select('calendar'),
                            child: const Text('View calendar'),
                          ),
                        ],
                      ),
                      if (upcoming.isEmpty)
                        const StationCard(
                          child: Text('No upcoming published shifts.'),
                        ),
                      for (final duty in upcoming)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: StationCard(
                            accent: blue,
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '${duty['duty_date']}',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      Text(
                                        '${duty['duty_category']}  ·  ${duty['start_time']} – ${duty['end_time']}',
                                        style: const TextStyle(
                                          color: muted,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                badge('SHIFT ${duty['shift_name']}'),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ],
                );
              },
            ),
            const SizedBox(height: 12),
            locationCard(),
            const SizedBox(height: 12),
            StationCard(
              accent: blue,
              child: ListTile(
                contentPadding: EdgeInsets.zero,
                title: const Text('My tasks'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => select('tasks'),
              ),
            ),
          ],
          if (canSeeLocations && showLocations) locationsSection(),
        ],
      ),
    );
  }

  Widget locationsSection() => Padding(
    key: locationsKey,
    padding: const EdgeInsets.only(top: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        pageHeading(
          'LIVE',
          'Live Locations',
          'Latest GPS position reported by each officer’s phone. Updates every minute.',
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton(
            onPressed: () => setState(() => showLocations = false),
            child: const Text('Hide Live Locations'),
          ),
        ),
        FutureBuilder<List<Json>>(
          future: homeLocations,
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Text(
                '${snapshot.error}',
                style: const TextStyle(color: Colors.red),
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final rows = snapshot.data!;
            if (rows.isEmpty) {
              return const Text('No officer has reported a location yet.');
            }
            return StationCard(
              child: Column(
                children: [for (final item in rows) locationTile(item)],
              ),
            );
          },
        ),
      ],
    ),
  );

  Widget locationTile(Json item) {
    final parsed = DateTime.tryParse('${item['last_updated']}');
    final fix = parsed == null || parsed.isUtc
        ? parsed
        : DateTime.tryParse('${item['last_updated']}Z');
    final age = fix == null ? null : DateTime.now().difference(fix);
    final freshness = age == null
        ? 'Update time unavailable'
        : '${age.inMinutes.clamp(0, 1000000)} min ago${age.inMinutes >= 3 ? ' · Stale' : ''}';
    final lat = item['latitude'];
    final lng = item['longitude'];
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text('${item['name']}'),
      subtitle: Text(
        [
          item['designation'],
          item['location_name'] ?? '$lat, $lng',
          freshness,
        ].whereType<String>().where((v) => v.isNotEmpty).join(' · '),
      ),
      trailing: IconButton(
        icon: const Icon(Icons.map_outlined),
        tooltip: 'Open in Maps',
        onPressed: () async {
          final opened = await launchUrl(
            Uri.https('www.google.com', '/maps/search/', {
              'api': '1',
              'query': '$lat,$lng',
            }),
            mode: LaunchMode.externalApplication,
          );
          if (!opened && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Could not open Maps')),
            );
          }
        },
      ),
    );
  }

  Widget badge(String value) => DecoratedBox(
    decoration: BoxDecoration(
      color: tint,
      borderRadius: BorderRadius.circular(12),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Text(
        value,
        style: const TextStyle(
          color: blue,
          fontSize: 10,
          fontWeight: FontWeight.bold,
        ),
      ),
    ),
  );

  Widget profilePage() {
    final user = widget.profile;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
      children: [
        pageHeading('PROFILE', name),
        const SizedBox(height: 12),
        StationCard(
          child: Column(
            children: [
              for (final (label, key) in [
                ('Username', 'username'),
                ('Role', 'role'),
                ('Service number', 'service_number'),
                ('Designation', 'designation'),
                ('Sector', 'sector_name'),
                ('Section', 'section'),
                ('Phone', 'contact_phone'),
                ('Reporting officer', 'reporting_officer'),
              ])
                if (user[key] != null)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(label),
                    trailing: Text('${user[key]}'),
                  ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        FilledButton(onPressed: widget.onLogout, child: const Text('Sign out')),
      ],
    );
  }

  Widget row(Json item) {
    final id = item['id'];
    String detail(Iterable<dynamic> parts) => parts
        .whereType<String>()
        .where((value) => value.isNotEmpty)
        .join(' · ');
    switch (screen) {
      case 'locations':
        final parsed = DateTime.tryParse('${item['last_updated']}');
        final fix = parsed == null || parsed.isUtc
            ? parsed
            : DateTime.tryParse('${item['last_updated']}Z');
        final age = fix == null ? null : DateTime.now().difference(fix);
        final freshness = age == null
            ? 'Update time unavailable'
            : '${age.inMinutes.clamp(0, 1000000)} min ago${age.inMinutes >= 3 ? ' · Stale' : ''}';
        final lat = item['latitude'];
        final lng = item['longitude'];
        return ListTile(
          title: Text('${item['name']}'),
          subtitle: Text(
            detail([item['location_name'] ?? '$lat, $lng', freshness]),
          ),
          trailing: IconButton(
            icon: const Icon(Icons.map_outlined),
            tooltip: 'Open in Maps',
            onPressed: () async {
              final opened = await launchUrl(
                Uri.https('www.google.com', '/maps/search/', {
                  'api': '1',
                  'query': '$lat,$lng',
                }),
                mode: LaunchMode.externalApplication,
              );
              if (!opened && mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Could not open Maps')),
                );
              }
            },
          ),
        );
      case 'notifications':
        return ListTile(
          title: Text('${item['title'] ?? 'Duty update'}'),
          subtitle: Text('${item['message'] ?? ''}'),
          trailing: item['is_read'] == true
              ? null
              : IconButton(
                  tooltip: 'Mark as read',
                  icon: const Icon(Icons.done),
                  onPressed: updating
                      ? null
                      : () => update('/notifications/$id/read'),
                ),
        );
      case 'tasks':
        return ListTile(
          title: Text('${item['custom_title'] ?? item['description']}'),
          subtitle: Text(detail([item['status'], item['expected_completion']])),
          trailing: PopupMenuButton<String>(
            enabled: !updating,
            onSelected: (value) =>
                update('/mobile/tasks/$id/status', payload: {'status': value}),
            itemBuilder: (context) => ['In Progress', 'On Hold', 'Completed']
                .map((value) => PopupMenuItem(value: value, child: Text(value)))
                .toList(),
          ),
        );
      case 'movements':
        return ListTile(
          title: Text('${item['purpose']}'),
          subtitle: Text(detail([item['destination'], item['status']])),
          trailing: switch (item['status']) {
            'pending_authorization' => TextButton(
              onPressed: updating
                  ? null
                  : () => update('/mobile/movements/$id/cancel'),
              child: const Text('Cancel'),
            ),
            'open' || 'overdue' => TextButton(
              onPressed: updating
                  ? null
                  : () => update('/mobile/movements/$id/return'),
              child: const Text('Record return'),
            ),
            _ => null,
          },
        );
      case 'requests':
        return ListTile(
          title: Text('${item['reason']}'),
          subtitle: Text(
            detail([
              item['officer_name'],
              item['current_roster_date'],
              item['status'],
            ]),
          ),
          trailing:
              item['status'] == 'pending' &&
                  item['staff_id'] == widget.profile['staff_id']
              ? TextButton(
                  onPressed: updating
                      ? null
                      : () => update(
                          '/rosters/change-requests/$id',
                          method: 'DELETE',
                        ),
                  child: const Text('Withdraw'),
                )
              : null,
        );
      case 'roster':
        final dutyDate = DateTime.tryParse('${item['duty_date']}');
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    'SHIFT ${item['shift_name']}',
                    style: const TextStyle(
                      color: blue,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                badge('PUBLISHED'),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              dutyDate == null
                  ? '${item['duty_date']}'
                  : MaterialLocalizations.of(context).formatFullDate(dutyDate),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            Text(
              '${item['start_time']} – ${item['end_time']}',
              style: const TextStyle(color: muted, fontSize: 13),
            ),
            const Divider(color: line),
            const Text(
              'DUTY ASSIGNMENT',
              style: TextStyle(
                color: muted,
                fontSize: 9,
                fontWeight: FontWeight.bold,
              ),
            ),
            Text(
              '${item['duty_category']}',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
            ),
            if (item['current_task'] case final String task
                when task.isNotEmpty)
              Text(task),
            TextButton(
              onPressed: updating ? null : () => requestDutyChange(item),
              child: const Text('Request a shift / duty change'),
            ),
          ],
        );
      default:
        return ListTile(
          title: Text(
            detail([item['duty_date'], 'Shift ${item['shift_name']}']),
          ),
          subtitle: Text(
            detail([
              item['current_task'],
              '${item['start_time']}–${item['end_time']}',
              if (screen == 'attendance')
                item['check_in_at'] == null ? 'No check-in' : 'Checked in',
            ]),
          ),
        );
    }
  }

  Widget morePage(Set<String> modules) {
    final entries = [
      if (linked) ...['tasks', 'movements'].where(modules.contains),
      if (linked && modules.contains('roster')) ...['calendar', 'requests'],
    ];
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
      children: [
        pageHeading('WORKSPACE', 'More'),
        const SizedBox(height: 12),
        if (entries.isNotEmpty)
          StationCard(
            child: Column(
              children: [
                for (final entry in entries)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(titles[entry]!),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => select(entry),
                  ),
              ],
            ),
          ),
      ],
    );
  }

  Widget bottomBar(Set<String> modules) {
    final tabs = [
      (
        'home',
        staff ? 'Home' : 'Dashboard',
        staff ? Icons.home : Icons.dashboard_outlined,
      ),
      if (staff && linked)
        ('calendar', 'Calendar', Icons.calendar_month_outlined),
      if (linked && modules.contains('roster'))
        ('roster', 'Roster', Icons.assignment_outlined),
      if (linked && modules.contains('attendance'))
        ('attendance', 'Attendance', Icons.fact_check_outlined),
      if (staff && linked && modules.contains('movements'))
        ('movements', 'Requests', Icons.description_outlined)
      else
        ('more', 'More', Icons.more_horiz),
    ];
    var selected = screen;
    if (screen == 'requests' && staff) {
      selected = 'roster';
    } else if (!staff &&
        [
          'requests',
          'calendar',
          'locations',
          'movements',
          'tasks',
        ].contains(screen)) {
      selected = 'more';
    }
    return Material(
      color: Colors.white,
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          child: Row(
            children: [
              for (final (key, label, icon) in tabs)
                Expanded(
                  child: Semantics(
                    button: true,
                    selected: selected == key,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: () => select(key),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              height: 32,
                              constraints: const BoxConstraints(maxWidth: 64),
                              alignment: Alignment.center,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(16),
                                color: selected == key
                                    ? tint
                                    : Colors.transparent,
                              ),
                              child: Icon(
                                icon,
                                size: 24,
                                color: selected == key ? blue : muted,
                              ),
                            ),
                            Text(
                              label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 11,
                                color: selected == key ? blue : muted,
                                fontWeight: selected == key
                                    ? FontWeight.bold
                                    : FontWeight.normal,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget calendarGrid(List<Json> duties) {
    final first = DateTime(month.year, month.month);
    final length = DateTime(month.year, month.month + 1, 0).day;
    final local = MaterialLocalizations.of(context);
    final scheduled = duties.map((duty) => duty['duty_date']).toSet();
    const dutyGreen = Color(0xff16834e);
    const dutyFill = Color(0xffe4f5eb);

    void changeMonth(int offset) {
      month = DateTime(month.year, month.month + offset);
      selectedDay = month;
      reload();
    }

    return StationCard(
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                icon: const Icon(Icons.chevron_left),
                tooltip: 'Previous month',
                onPressed: () => changeMonth(-1),
              ),
              Expanded(
                child: Text(
                  local.formatMonthYear(month),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.chevron_right),
                tooltip: 'Next month',
                onPressed: () => changeMonth(1),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final label in const ['S', 'M', 'T', 'W', 'T', 'F', 'S'])
                Expanded(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: muted,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
            ],
          ),
          for (var week = 0; week < 6; week++)
            Row(
              children: [
                for (
                  var day = week * 7 - first.weekday % 7 + 1;
                  day < week * 7 - first.weekday % 7 + 8;
                  day++
                )
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(2),
                      child: SizedBox(
                        height: 44,
                        child: day < 1 || day > length
                            ? null
                            : Builder(
                                builder: (context) {
                                  final cell = DateTime(
                                    month.year,
                                    month.month,
                                    day,
                                  );
                                  final assigned = scheduled.contains(
                                    date(cell),
                                  );
                                  final active = DateUtils.isSameDay(
                                    cell,
                                    selectedDay,
                                  );
                                  final today = DateUtils.isSameDay(
                                    cell,
                                    DateTime.now(),
                                  );
                                  return Semantics(
                                    button: true,
                                    selected: active,
                                    label:
                                        '${local.formatFullDate(cell)}${assigned ? ', assigned duty' : ''}',
                                    excludeSemantics: true,
                                    child: Material(
                                      color: active
                                          ? blue
                                          : assigned
                                          ? dutyFill
                                          : Colors.white,
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(8),
                                        side: BorderSide(
                                          color: active
                                              ? blue
                                              : today
                                              ? const Color(0xff4c8ec2)
                                              : assigned
                                              ? const Color(0xffc6e4d5)
                                              : Colors.transparent,
                                        ),
                                      ),
                                      child: InkWell(
                                        borderRadius: BorderRadius.circular(8),
                                        onTap: () =>
                                            setState(() => selectedDay = cell),
                                        child: Column(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          children: [
                                            Text(
                                              '$day',
                                              style: TextStyle(
                                                color: active
                                                    ? Colors.white
                                                    : ink,
                                                fontSize: 12,
                                                fontWeight: active || today
                                                    ? FontWeight.bold
                                                    : FontWeight.normal,
                                              ),
                                            ),
                                            SizedBox(
                                              width: 4,
                                              height: 4,
                                              child: assigned
                                                  ? DecoratedBox(
                                                      decoration: BoxDecoration(
                                                        shape: BoxShape.circle,
                                                        color: active
                                                            ? Colors.white
                                                            : dutyGreen,
                                                      ),
                                                    )
                                                  : null,
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                  );
                                },
                              ),
                      ),
                    ),
                  ),
              ],
            ),
          const SizedBox(height: 8),
          const Row(
            children: [
              Icon(Icons.circle, color: dutyGreen, size: 7),
              SizedBox(width: 6),
              Text(
                'Published shift',
                style: TextStyle(color: muted, fontSize: 10),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget modulePage() => FutureBuilder<List<Json>>(
    future: data,
    builder: (context, snapshot) {
      final allItems = snapshot.data ?? <Json>[];
      final items = screen == 'calendar'
          ? allItems.where((item) => item['duty_date'] == date(selectedDay))
          : allItems;
      return RefreshIndicator(
        onRefresh: () async {
          reload();
          await data?.then<void>((_) {}, onError: (Object _) {});
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
          children: [
            if (screen == 'roster')
              pageHeading(
                'MY DUTIES',
                'Published roster',
                'Your assigned shifts and duty details.',
              )
            else if (screen == 'attendance')
              pageHeading(
                'ATTENDANCE',
                titles[screen]!,
                'Attendance is recorded automatically when you sign in and sign out.',
              )
            else if (screen == 'calendar')
              pageHeading(
                'MY DUTIES',
                'My duty diary',
                'Tap any date to view your assigned shift, duty, and attendance.',
              )
            else
              pageHeading(
                screen == 'movements' ? 'REQUESTS' : 'DUTY MANAGEMENT',
                titles[screen]!,
              ),
            const SizedBox(height: 12),
            if (screen == 'roster')
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: FilledButton(
                  onPressed: () => select('requests'),
                  child: const Text('View shift / duty change requests'),
                ),
              ),
            if (screen == 'movements')
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: FilledButton(
                  onPressed: updating ? null : newMovement,
                  child: const Text('Request outside movement'),
                ),
              ),
            if (screen == 'requests' && linked)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: FilledButton.icon(
                  onPressed: updating ? null : () => requestDutyChange(),
                  icon: const Icon(Icons.add),
                  label: const Text('New shift / duty change request'),
                ),
              ),
            if (screen == 'calendar') ...[
              calendarGrid(allItems),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  MaterialLocalizations.of(context).formatFullDate(selectedDay),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
            if (snapshot.connectionState != ConnectionState.done)
              const LinearProgressIndicator()
            else if (snapshot.hasError)
              StationCard(
                child: Text(
                  snapshot.error is ApiException
                      ? snapshot.error.toString()
                      : 'Could not load this page. Pull down to retry.',
                ),
              )
            else if (items.isEmpty)
              StationCard(
                child: Text(switch (screen) {
                  'calendar' =>
                    'No published duty diary entry was found for this date.',
                  'roster' => 'No published roster assignments were found for your account.',
                  'attendance' =>
                    'There is no published shift assigned to you today.',
                  _ => 'No records to show',
                }),
              )
            else
              for (final item in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: StationCard(accent: blue, child: row(item)),
                ),
          ],
        ),
      );
    },
  );

  @override
  Widget build(BuildContext context) => FutureBuilder<Set<String>>(
    future: widget.modules,
    builder: (context, snapshot) {
      final modules = snapshot.data ?? const <String>{};
      return PopScope(
        canPop: screen == 'home',
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop && screen != 'home') {
            final parent = switch (screen) {
              'requests' when staff => 'roster',
              'locations' ||
              'tasks' ||
              'requests' ||
              'calendar' ||
              'movements' when !staff => 'more',
              _ => 'home',
            };
            select(parent);
          }
        },
        child: Scaffold(
          bottomNavigationBar: bottomBar(modules),
          body: ChatLauncher(
            api: widget.api,
            profile: widget.profile,
            child: Column(
              children: [
                StationHeader(
                  initial: name.trim().isEmpty
                      ? 'S'
                      : name.trim().characters.first.toUpperCase(),
                  onNotifications: () => select('notifications'),
                  onProfile: () => select('profile'),
                ),
                if (screen != 'home')
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => select('home'),
                      icon: const Icon(Icons.arrow_back),
                      label: Text(staff ? 'Back to Home' : 'Back to Dashboard'),
                    ),
                  ),
                Expanded(
                  child: switch (screen) {
                    'home' => home(),
                    'profile' => profilePage(),
                    'more' => morePage(modules),
                    _ => modulePage(),
                  },
                ),
              ],
            ),
          ),
        ),
      );
    },
  );
}
