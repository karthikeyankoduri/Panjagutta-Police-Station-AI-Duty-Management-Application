import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'api.dart';

class LocationReporting extends ChangeNotifier {
  LocationReporting(this.api);

  final DutyApi api;
  StreamSubscription<Position>? _positions;
  bool _starting = false;
  bool _sending = false;
  int _generation = 0;
  final _clock = Stopwatch()..start();
  Duration? _lastAttempt;
  DateTime? lastReportedFix;
  String status = 'Location sharing is off';
  bool get active => _positions != null || _starting;

  Future<void> start() async {
    if (active) return;
    final generation = ++_generation;
    _starting = true;
    _setStatus('Checking location permission…');
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        if (generation == _generation) {
          _setStatus('Turn on device location and try again');
        }
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied &&
          generation == _generation) {
        permission = await Geolocator.requestPermission();
      }
      if (generation != _generation) return;
      if (permission != LocationPermission.whileInUse &&
          permission != LocationPermission.always) {
        _setStatus('Allow location access in Settings and try again');
        return;
      }
      final settings = Platform.isAndroid
          ? AndroidSettings(
              intervalDuration: const Duration(minutes: 1),
              foregroundNotificationConfig: const ForegroundNotificationConfig(
                notificationTitle: 'Duty location sharing',
                notificationText:
                    'Your location is being shared with the station.',
                enableWakeLock: true,
              ),
            )
          : AppleSettings(
              allowBackgroundLocationUpdates: true,
              showBackgroundLocationIndicator: true,
            );
      _positions = Geolocator.getPositionStream(locationSettings: settings)
          .listen(
            (position) => unawaited(_report(position, generation)),
            onError: (Object _) {
              if (generation != _generation) return;
              unawaited(
                stop('Location updates interrupted. Start sharing to retry.'),
              );
            },
            onDone: () {
              if (generation != _generation) return;
              unawaited(
                stop('Location updates ended. Start sharing to retry.'),
              );
            },
          );
      _setStatus('Waiting for a location fix…');
    } catch (_) {
      if (generation == _generation) {
        _setStatus('Could not start location sharing');
      }
    } finally {
      if (generation == _generation) {
        _starting = false;
        notifyListeners();
      }
    }
  }

  Future<void> _report(Position position, int generation) async {
    final previousAttempt = _lastAttempt;
    if (generation != _generation ||
        _sending ||
        api.token == null ||
        (previousAttempt != null &&
            _clock.elapsed - previousAttempt < const Duration(minutes: 1)) ||
        DateTime.now().difference(position.timestamp) >
            const Duration(minutes: 2)) {
      return;
    }
    _sending = true;
    _lastAttempt = _clock.elapsed;
    try {
      await api.request(
        '/mobile/location',
        method: 'POST',
        body: {
          'latitude': position.latitude,
          'longitude': position.longitude,
          'timestamp': position.timestamp.toUtc().toIso8601String(),
        },
      );
      if (generation != _generation) return;
      lastReportedFix = position.timestamp;
      _setStatus('Location sharing is on');
    } on ApiException catch (error) {
      if (generation != _generation) return;
      if (error.status == 403) {
        await stop(error.message);
      } else {
        _setStatus('Report failed. Retrying as fresh fixes arrive.');
      }
    } catch (_) {
      if (generation == _generation) {
        _setStatus('Report failed. Retrying as fresh fixes arrive.');
      }
    } finally {
      _sending = false;
    }
  }

  Future<void> stop([String message = 'Location sharing is off']) async {
    ++_generation;
    final subscription = _positions;
    _positions = null;
    _starting = false;
    _lastAttempt = null;
    _setStatus(message);
    await subscription?.cancel();
  }

  void _setStatus(String message) {
    status = message;
    notifyListeners();
  }

  @override
  void dispose() {
    ++_generation;
    unawaited(_positions?.cancel());
    super.dispose();
  }
}
