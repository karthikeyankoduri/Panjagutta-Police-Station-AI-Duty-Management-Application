import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

typedef Json = Map<String, dynamic>;

class ApiException implements Exception {
  final int status;
  final String message;
  const ApiException(this.status, this.message);

  @override
  String toString() => message;
}

class DutyApi {
  final Uri base;
  final http.Client _client;
  String? token;
  void Function()? onExpired;

  DutyApi(this.base, {http.Client? client}) : _client = client ?? http.Client();

  static Uri server(String value) {
    final uri = Uri.tryParse(value.trim());
    if (uri == null ||
        (uri.scheme != 'https' && !(kDebugMode && uri.scheme == 'http')) ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasQuery ||
        uri.hasFragment) {
      throw const FormatException('Enter a valid HTTPS server address.');
    }
    final path = uri.path.replaceFirst(RegExp(r'/+$'), '');
    return uri.replace(path: path.endsWith('/api') ? path : '$path/api');
  }

  Future<dynamic> request(
    String path, {
    String method = 'GET',
    Json? body,
  }) async {
    final currentToken = token;
    final request = http.Request(method, Uri.parse('$base$path'))
      ..followRedirects = false
      ..headers['Accept'] = 'application/json';
    if (currentToken != null) {
      request.headers['Authorization'] = 'Bearer $currentToken';
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await _client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(const Duration(seconds: 20));
    dynamic data;
    try {
      data = jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          response.bodyBytes.isNotEmpty) {
        throw const FormatException('The server did not return JSON.');
      }
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      if (response.statusCode == 401 &&
          currentToken != null &&
          token == currentToken &&
          path != '/auth/logout') {
        onExpired?.call();
      }
      final detail = data is Json ? data['detail'] : null;
      throw ApiException(
        response.statusCode,
        detail is String
            ? detail
            : 'Request failed (HTTP ${response.statusCode}).',
      );
    }
    return data;
  }

  void close() => _client.close();
}
