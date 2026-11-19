import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const navy = Color(0xff0f2238);
const blue = Color(0xff1a56db);
const gold = Color(0xffc9a227);
const ink = Color(0xff1e293b);
const muted = Color(0xff64748b);
const background = Color(0xfff4f6f9);
const line = Color(0xffe2e8f0);
const tint = Color(0xffe9f0fe);
const crest = 'assets/login_police_crest.png';

ThemeData stationTheme() => ThemeData(
  scaffoldBackgroundColor: background,
  colorScheme: ColorScheme.fromSeed(seedColor: blue).copyWith(
    primary: blue,
    onPrimary: Colors.white,
    surface: Colors.white,
    onSurface: ink,
  ),
  cardTheme: CardThemeData(
    color: Colors.white,
    elevation: 0,
    margin: EdgeInsets.zero,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(12),
      side: const BorderSide(color: line),
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(0, 48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      textStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
    ),
  ),
);

class StationHeader extends StatelessWidget {
  const StationHeader({
    super.key,
    required this.initial,
    required this.onNotifications,
    required this.onProfile,
    this.onChat,
  });

  final String initial;
  final VoidCallback onNotifications;
  final VoidCallback onProfile;
  final VoidCallback? onChat;

  @override
  Widget build(BuildContext context) => AnnotatedRegion<SystemUiOverlayStyle>(
    value: SystemUiOverlayStyle.light,
    child: DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [Color(0xff0a1829), navy, Color(0xff183454)],
        ),
        border: Border(bottom: BorderSide(color: gold, width: 2)),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 14, 12),
          child: Row(
            children: [
              Image.asset(
                crest,
                width: 36,
                height: 42,
                semanticLabel: 'Hyderabad City Police crest',
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'HYDERABAD CITY POLICE',
                      style: TextStyle(
                        fontSize: 9,
                        letterSpacing: 1.3,
                        fontWeight: FontWeight.bold,
                        color: gold,
                      ),
                    ),
                    SizedBox(height: 1),
                    Text(
                      'Panjagutta Police Station',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
              if (onChat != null)
                IconButton(
                  tooltip: 'Chat',
                  onPressed: onChat,
                  color: Colors.white,
                  icon: const Icon(Icons.chat_bubble_outline),
                ),
              IconButton(
                tooltip: 'Notifications',
                onPressed: onNotifications,
                color: Colors.white,
                icon: const Icon(Icons.notifications_outlined),
              ),
              Semantics(
                button: true,
                label: 'My profile',
                child: InkWell(
                  onTap: onProfile,
                  customBorder: const CircleBorder(),
                  child: Container(
                    width: 42,
                    height: 42,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: const Color(0x33ffffff),
                      border: Border.all(color: gold, width: 2),
                    ),
                    child: Text(
                      initial,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class StationCard extends StatelessWidget {
  const StationCard({super.key, required this.child, this.accent});

  final Widget child;
  final Color? accent;

  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (accent != null)
            ColoredBox(color: accent!, child: const SizedBox(width: 3)),
          Expanded(
            child: Padding(padding: const EdgeInsets.all(14), child: child),
          ),
        ],
      ),
    ),
  );
}
