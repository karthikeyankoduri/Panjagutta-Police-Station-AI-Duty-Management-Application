import 'dart:async';

import 'package:flutter/material.dart';

import 'api.dart';
import 'station_style.dart';

const _superiorRoles = {'SUPER_ADMIN', 'SHO', 'ADMIN_SI'};
const _pollEvery = Duration(seconds: 8);

bool isChatSuperior(Json profile) => _superiorRoles.contains(profile['role']);

DateTime? _when(Object? iso) {
  final text = '$iso';
  final parsed = DateTime.tryParse(text);
  if (parsed == null) return null;
  final hasZone =
      text.endsWith('Z') || RegExp(r'[+-]\d\d:?\d\d$').hasMatch(text);
  return (parsed.isUtc || hasZone ? parsed : DateTime.tryParse('${text}Z'))
      ?.toLocal();
}

String _clock(Object? iso) {
  final t = _when(iso);
  if (t == null) return '';
  final now = DateTime.now();
  final hm =
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  if (t.year == now.year && t.month == now.month && t.day == now.day) return hm;
  return '${t.day.toString().padLeft(2, '0')}/${t.month.toString().padLeft(2, '0')} $hm';
}

String _roleLabel(Object? role) => switch ('$role') {
  'SUPER_ADMIN' => 'Super Admin',
  'SHO' => 'SHO',
  'ADMIN_SI' => 'Admin SI',
  'SECTOR_SI' => 'Sector SI',
  'DI' => 'DI',
  'DSI' => 'DSI',
  'STAFF' => 'Staff',
  _ => '',
};

/// Chat entry point. Superiors (Super Admin, SHO, Admin SI) get a list of every user's thread plus the
/// Station channel and a "Message everyone" action. Everyone else gets the Station channel and their own
/// thread with the superiors. The server enforces who can read what.
class ChatPage extends StatefulWidget {
  const ChatPage({super.key, required this.api, required this.profile});

  final DutyApi api;
  final Json profile;

  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  Future<Json>? threads;
  Json? open; // thread selected by a superior
  String query = '';
  Timer? timer;

  bool get superior => isChatSuperior(widget.profile);

  @override
  void initState() {
    super.initState();
    threads = fetch();
    timer = Timer.periodic(_pollEvery, (_) {
      if (mounted && open == null) reload();
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<Json> fetch() async =>
      (await widget.api.request('/chat/threads')) as Json;

  // The setState callback must not return the Future, so assign inside a block body.
  void reload() {
    final next = fetch();
    setState(() {
      threads = next;
    });
  }

  Future<void> broadcast() async {
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Message everyone'),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLength: 1000,
          minLines: 2,
          maxLines: 6,
          decoration: const InputDecoration(
            hintText:
                'This goes to every user and appears in the Station channel',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Send to all'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (text == null || text.isEmpty) return;
    try {
      await widget.api.request(
        '/chat/broadcast',
        method: 'POST',
        body: {'body': text},
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Sent to everyone')));
      reload();
    } on Object catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('$error')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (superior) {
      final thread = open;
      if (thread != null) {
        return PopScope(
          canPop: false,
          onPopInvokedWithResult: (didPop, _) {
            if (!didPop) {
              setState(() => open = null);
              reload();
            }
          },
          child: ChatConversation(
            key: ValueKey(thread['thread_user_id']),
            api: widget.api,
            threadUserId: thread['thread_user_id'] as int?,
            title: '${thread['title']}',
            subtitle: thread['kind'] == 'station'
                ? 'Visible to everyone'
                : 'Visible to this user and the SHO / Admin SI / Super Admin',
            onBack: () {
              setState(() => open = null);
              reload();
            },
          ),
        );
      }
      return superiorList();
    }
    return userTabs();
  }

  Widget superiorList() => FutureBuilder<Json>(
    future: threads,
    builder: (context, snapshot) {
      final all = ((snapshot.data?['threads'] as List?) ?? const [])
          .cast<Json>();
      final q = query.trim().toLowerCase();
      final qDigits = q.replaceAll(RegExp(r'\D'), '');
      final shown = all.where((t) {
        if (q.isEmpty) return true;
        final phone = '${t['phone'] ?? ''}';
        return '${t['title']} ${t['subtitle'] ?? ''} $phone'
                .toLowerCase()
                .contains(q) ||
            (qDigits.length >= 3 &&
                phone.replaceAll(RegExp(r'\D'), '').contains(qDigits));
      }).toList();
      return RefreshIndicator(
        onRefresh: () async {
          reload();
          await threads?.then<void>((_) {}, onError: (Object _) {});
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
          children: [
            const Text(
              'CHAT',
              style: TextStyle(
                fontSize: 11,
                letterSpacing: 1.2,
                fontWeight: FontWeight.bold,
                color: gold,
              ),
            ),
            const SizedBox(height: 4),
            const Text(
              'Messages',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: snapshot.hasData ? broadcast : null,
              icon: const Icon(Icons.campaign_outlined),
              label: const Text('Message everyone'),
            ),
            const SizedBox(height: 12),
            TextField(
              onChanged: (v) => setState(() => query = v),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search name, service no. or phone',
                isDense: true,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            if (snapshot.hasError)
              Text(
                '${snapshot.error}',
                style: const TextStyle(color: Colors.red),
              )
            else if (!snapshot.hasData)
              const Center(child: CircularProgressIndicator())
            else if (shown.isEmpty)
              const Text('No one matches your search.')
            else
              StationCard(
                child: Column(
                  children: [
                    for (final t in shown)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          child: Icon(
                            t['kind'] == 'station'
                                ? Icons.groups
                                : Icons.person,
                          ),
                        ),
                        title: Text('${t['title']}'),
                        subtitle: Text(
                          (t['last'] as Json?)?['body'] as String? ??
                              [t['subtitle'], t['phone']]
                                  .whereType<String>()
                                  .where((v) => v.isNotEmpty)
                                  .join(' · '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: (t['unread'] as int? ?? 0) > 0
                            ? Badge.count(count: t['unread'] as int)
                            : null,
                        onTap: () => setState(() => open = t),
                      ),
                  ],
                ),
              ),
          ],
        ),
      );
    },
  );

  Widget userTabs() => DefaultTabController(
    length: 2,
    child: Column(
      children: [
        FutureBuilder<Json>(
          future: threads,
          builder: (context, snapshot) {
            final list = ((snapshot.data?['threads'] as List?) ?? const [])
                .cast<Json>();
            int unread(String kind) => list
                .where((t) => t['kind'] == kind)
                .fold(0, (sum, t) => sum + ((t['unread'] as int?) ?? 0));
            Widget label(String text, int n) => Tab(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(text),
                  if (n > 0) ...[
                    const SizedBox(width: 6),
                    Badge.count(count: n),
                  ],
                ],
              ),
            );
            return TabBar(
              tabs: [
                label('Station', unread('station')),
                label('Admin / SHO', unread('direct')),
              ],
            );
          },
        ),
        Expanded(
          child: TabBarView(
            children: [
              ChatConversation(
                api: widget.api,
                threadUserId: null,
                title: 'Station channel',
                subtitle: 'Visible to everyone',
                onActivity: reload,
              ),
              ChatConversation(
                api: widget.api,
                threadUserId: widget.profile['id'] as int?,
                title: 'Admin / SHO',
                subtitle:
                    'Private: only you and the SHO / Admin SI / Super Admin',
                onActivity: reload,
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

/// One conversation: loads the history, polls for new messages while it is open, and sends text.
class ChatConversation extends StatefulWidget {
  const ChatConversation({
    super.key,
    required this.api,
    required this.threadUserId,
    required this.title,
    this.subtitle,
    this.onBack,
    this.onActivity,
  });

  final DutyApi api;
  final int? threadUserId; // null = Station channel
  final String title;
  final String? subtitle;
  final VoidCallback? onBack;
  final VoidCallback? onActivity;

  @override
  State<ChatConversation> createState() => _ChatConversationState();
}

class _ChatConversationState extends State<ChatConversation>
    with AutomaticKeepAliveClientMixin {
  final messages = <Json>[];
  final input = TextEditingController();
  final scroll = ScrollController();
  Timer? timer;
  bool loading = true;
  bool sending = false;
  bool polling = false;
  String? error;

  @override
  bool get wantKeepAlive => true;

  String get query => widget.threadUserId == null
      ? ''
      : 'thread_user_id=${widget.threadUserId}';

  @override
  void initState() {
    super.initState();
    poll();
    timer = Timer.periodic(_pollEvery, (_) => poll());
  }

  @override
  void dispose() {
    timer?.cancel();
    input.dispose();
    scroll.dispose();
    super.dispose();
  }

  Future<void> poll() async {
    if (polling) return;
    polling = true;
    try {
      final since = messages.isEmpty ? null : messages.last['id'] as int;
      final params = [
        if (query.isNotEmpty) query,
        if (since != null) 'since_id=$since',
      ].join('&');
      final result = await widget.api.request(
        '/chat/messages${params.isEmpty ? '' : '?$params'}',
      ) as Json;
      final fresh = (result['items'] as List).cast<Json>();
      if (!mounted) return;
      setState(() {
        loading = false;
        error = null;
        messages.addAll(fresh);
      });
      if (fresh.isNotEmpty) {
        scrollToEnd();
        await widget.api.request(
          '/chat/read',
          method: 'POST',
          body: {'thread_user_id': widget.threadUserId},
        );
        widget.onActivity?.call();
      }
    } on Object catch (e) {
      if (mounted) {
        setState(() {
          loading = false;
          error = '$e';
        });
      }
    } finally {
      polling = false;
    }
  }

  void scrollToEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (scroll.hasClients) {
      scroll.animateTo(
        scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    }
  });

  Future<void> send() async {
    final text = input.text.trim();
    if (text.isEmpty || sending) return;
    setState(() => sending = true);
    try {
      await widget.api.request(
        '/chat/messages',
        method: 'POST',
        body: {'body': text, 'thread_user_id': widget.threadUserId},
      );
      input.clear();
      await poll();
    } on Object catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  Widget bubble(Json m) {
    final mine = m['mine'] == true;
    final broadcast = m['kind'] == 'broadcast';
    final role = _roleLabel(m['sender_role']);
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.8,
        ),
        decoration: BoxDecoration(
          color: broadcast
              ? const Color(0xfffff4d6)
              : mine
              ? navy
              : const Color(0xffe8edf3),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (!mine || broadcast)
              Text(
                [
                  if (broadcast) 'To everyone',
                  '${m['sender_name']}${role.isEmpty ? '' : ' · $role'}',
                ].join(' · '),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: mine ? Colors.black87 : Colors.black54,
                ),
              ),
            Text(
              '${m['body']}',
              style: TextStyle(
                color: mine && !broadcast ? Colors.white : Colors.black87,
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                _clock(m['created_at']),
                style: TextStyle(
                  fontSize: 10,
                  color: mine && !broadcast ? Colors.white70 : Colors.black45,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Column(
      children: [
        Material(
          color: Colors.white,
          child: ListTile(
            leading: widget.onBack == null
                ? null
                : IconButton(
                    tooltip: 'Back',
                    icon: const Icon(Icons.arrow_back),
                    onPressed: widget.onBack,
                  ),
            title: Text(
              widget.title,
              style: const TextStyle(fontWeight: FontWeight.bold),
            ),
            subtitle: widget.subtitle == null ? null : Text(widget.subtitle!),
          ),
        ),
        const Divider(height: 1),
        if (error != null)
          Container(
            width: double.infinity,
            color: const Color(0xfffdecea),
            padding: const EdgeInsets.all(8),
            child: Text(error!, style: const TextStyle(color: Colors.red)),
          ),
        Expanded(
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : messages.isEmpty
              ? const Center(child: Text('No messages yet. Say hello.'))
              : ListView(
                  controller: scroll,
                  padding: const EdgeInsets.all(12),
                  children: [for (final m in messages) bubble(m)],
                ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: input,
                    minLines: 1,
                    maxLines: 4,
                    maxLength: 1000,
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => send(),
                    decoration: const InputDecoration(
                      hintText: 'Type a message',
                      counterText: '',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                IconButton.filled(
                  tooltip: 'Send',
                  onPressed: sending ? null : send,
                  icon: const Icon(Icons.send),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Floating chat: a round button hovers over the screen (bottom-right); tapping it expands into the chat
/// box (the same [ChatPage]). Shows the unread count on the button while collapsed.
class ChatLauncher extends StatefulWidget {
  const ChatLauncher({
    super.key,
    required this.api,
    required this.profile,
    required this.child,
  });

  final DutyApi api;
  final Json profile;
  final Widget child;

  @override
  State<ChatLauncher> createState() => _ChatLauncherState();
}

class _ChatLauncherState extends State<ChatLauncher> {
  bool open = false;
  int unread = 0;
  Timer? timer;

  @override
  void initState() {
    super.initState();
    refreshUnread();
    timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (!open) refreshUnread();
    });
  }

  @override
  void dispose() {
    timer?.cancel();
    super.dispose();
  }

  Future<void> refreshUnread() async {
    try {
      final result = await widget.api.request('/chat/threads') as Json;
      final total = (result['threads'] as List).cast<Json>().fold<int>(
        0,
        (sum, t) => sum + ((t['unread'] as int?) ?? 0),
      );
      if (mounted) setState(() => unread = total);
    } on Object {
      // The badge is best-effort.
    }
  }

  void toggle() {
    setState(() => open = !open);
    if (!open) refreshUnread();
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.sizeOf(context);
    return Stack(
      children: [
        widget.child,
        if (open)
          Positioned.fill(
            child: GestureDetector(
              onTap: toggle,
              child: const ColoredBox(color: Color(0x66000000)),
            ),
          ),
        Positioned(
          right: 12,
          bottom: 12,
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 200),
            child: open
                ? Material(
                    key: const ValueKey('chat-box'),
                    elevation: 12,
                    borderRadius: BorderRadius.circular(16),
                    clipBehavior: Clip.antiAlias,
                    color: background,
                    child: SizedBox(
                      width: size.width - 24 > 420 ? 420 : size.width - 24,
                      height: size.height * 0.72,
                      child: Column(
                        children: [
                          Container(
                            color: navy,
                            padding: const EdgeInsets.fromLTRB(16, 4, 4, 4),
                            child: Row(
                              children: [
                                const Expanded(
                                  child: Text(
                                    'Chat',
                                    style: TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 16,
                                    ),
                                  ),
                                ),
                                IconButton(
                                  tooltip: 'Close chat',
                                  color: Colors.white,
                                  icon: const Icon(Icons.close),
                                  onPressed: toggle,
                                ),
                              ],
                            ),
                          ),
                          Expanded(
                            child: ChatPage(
                              api: widget.api,
                              profile: widget.profile,
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                : Badge(
                    key: const ValueKey('chat-button'),
                    isLabelVisible: unread > 0,
                    label: Text('$unread'),
                    child: FloatingActionButton(
                      heroTag: 'chat-launcher',
                      tooltip: 'Open chat',
                      backgroundColor: navy,
                      foregroundColor: Colors.white,
                      onPressed: toggle,
                      child: const Icon(Icons.chat_bubble),
                    ),
                  ),
          ),
        ),
      ],
    );
  }
}
