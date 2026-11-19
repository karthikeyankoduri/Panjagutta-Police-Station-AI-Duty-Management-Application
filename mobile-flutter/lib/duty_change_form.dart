import 'package:flutter/material.dart';

import 'api.dart';

/// "Submit Duty / Shift Change Request" — the same fields as the web form:
/// Roster ID, Current Date, Current Shift, Current Duty Category, Requested Shift,
/// Requested Duty Point and Reason. Duties, shifts and duty points are dropdowns; picking one of the
/// officer's published duties fills the roster, date, shift and duty for them.
class DutyChangeDialog extends StatefulWidget {
  const DutyChangeDialog({
    super.key,
    required this.duties,
    required this.shifts,
    required this.dutyCategories,
    this.initial,
  });

  /// The officer's published duties (from /mobile/rosters).
  final List<Json> duties;

  /// [{code, start_time, end_time}] from /mobile/duty-options.
  final List<Json> shifts;
  final List<String> dutyCategories;

  /// A duty to pre-fill (when the request is started from a duty card).
  final Json? initial;

  @override
  State<DutyChangeDialog> createState() => _DutyChangeDialogState();
}

class _DutyChangeDialogState extends State<DutyChangeDialog> {
  final form = GlobalKey<FormState>();
  final rosterId = TextEditingController();
  final reason = TextEditingController();
  DateTime? date;
  String currentShift = 'A';
  String? currentDuty;
  String requestedShift = '';
  String? requestedDuty;
  int? pickedDuty; // index in widget.duties
  String? problem;

  List<String> get shiftCodes {
    final codes = widget.shifts.map((s) => '${s['code']}').toList();
    return codes.isEmpty ? ['A', 'B', 'C'] : codes;
  }

  String shiftLabel(String code) {
    final match = widget.shifts.where((s) => s['code'] == code);
    if (match.isEmpty) return 'Shift $code';
    final s = match.first;
    return 'Shift $code (${s['start_time']}–${s['end_time']})';
  }

  /// Duty points offered in a dropdown; keeps a value that is not in the list (e.g. an older duty).
  List<String> dutyChoices(String? keep) => [
    ...widget.dutyCategories,
    if (keep != null &&
        keep.isNotEmpty &&
        !widget.dutyCategories.contains(keep))
      keep,
  ];

  @override
  void initState() {
    super.initState();
    final first = widget.initial;
    if (first != null) {
      final index = widget.duties.indexWhere(
        (d) =>
            d['roster_id'] == first['roster_id'] &&
            d['duty_category'] == first['duty_category'],
      );
      apply(first, index < 0 ? null : index);
    }
  }

  @override
  void dispose() {
    rosterId.dispose();
    reason.dispose();
    super.dispose();
  }

  void apply(Json duty, int? index) {
    pickedDuty = index;
    rosterId.text = '${duty['roster_id'] ?? ''}';
    date = DateTime.tryParse('${duty['duty_date']}');
    final code = '${duty['shift_name']}';
    currentShift = shiftCodes.contains(code) ? code : shiftCodes.first;
    final category = '${duty['duty_category'] ?? ''}';
    currentDuty = category.isEmpty ? null : category;
    // Like the web form: suggest the other shift by default.
    requestedShift = shiftCodes.firstWhere(
      (c) => c != currentShift,
      orElse: () => '',
    );
  }

  String two(int v) => v.toString().padLeft(2, '0');
  String iso(DateTime d) => '${d.year}-${two(d.month)}-${two(d.day)}';

  Future<void> pickDate() async {
    final now = DateTime.now();
    final chosen = await showDatePicker(
      context: context,
      initialDate: date ?? now,
      firstDate: now.subtract(const Duration(days: 31)),
      lastDate: now.add(const Duration(days: 366)),
    );
    if (chosen != null) setState(() => date = chosen);
  }

  void submit() {
    final valid = form.currentState!.validate();
    final wantsChange = requestedShift.isNotEmpty || requestedDuty != null;
    setState(
      () => problem = wantsChange
          ? null
          : 'Choose a requested shift or a requested duty point.',
    );
    if (!valid || !wantsChange) return;
    Navigator.pop(context, {
      'roster_id': int.parse(rosterId.text.trim()),
      'current_roster_date': iso(date!),
      'current_shift_code': currentShift,
      'current_duty_category': currentDuty,
      'requested_shift_code': requestedShift.isEmpty ? null : requestedShift,
      'requested_duty_category': requestedDuty,
      'reason': reason.text.trim(),
    });
  }

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 12);
    return AlertDialog(
      title: const Text('Submit Duty / Shift Change Request'),
      scrollable: true,
      content: Form(
        key: form,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Use this form when your rostered shift or duty allocation cannot be fulfilled '
              'due to unavoidable medical, personal, or operational conflicts.',
              style: TextStyle(fontSize: 12.5),
            ),
            gap,
            if (widget.duties.isNotEmpty) ...[
              DropdownButtonFormField<int>(
                isExpanded: true,
                initialValue: pickedDuty,
                decoration: const InputDecoration(
                  labelText: 'My published duty (fills the fields below)',
                ),
                items: [
                  for (var i = 0; i < widget.duties.length; i++)
                    DropdownMenuItem(
                      value: i,
                      child: Text(
                        '${widget.duties[i]['duty_date']} · Shift ${widget.duties[i]['shift_name']} · ${widget.duties[i]['duty_category']}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                ],
                onChanged: (i) {
                  if (i != null) setState(() => apply(widget.duties[i], i));
                },
              ),
              gap,
            ],
            TextFormField(
              controller: rosterId,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'Roster ID *',
                helperText: 'Filled in when you pick a published duty',
              ),
              validator: (v) => int.tryParse((v ?? '').trim()) == null
                  ? 'Enter the roster ID'
                  : null,
            ),
            gap,
            FormField<DateTime>(
              validator: (_) => date == null ? 'Choose the current date' : null,
              builder: (state) => InkWell(
                onTap: () async {
                  await pickDate();
                  state.validate();
                },
                child: InputDecorator(
                  decoration: InputDecoration(
                    labelText: 'Current Date *',
                    errorText: state.errorText,
                    suffixIcon: const Icon(Icons.calendar_today_outlined),
                  ),
                  child: Text(date == null ? 'Select date' : iso(date!)),
                ),
              ),
            ),
            gap,
            DropdownButtonFormField<String>(
              isExpanded: true,
              initialValue: currentShift,
              decoration: const InputDecoration(labelText: 'Current Shift *'),
              items: [
                for (final c in shiftCodes)
                  DropdownMenuItem(value: c, child: Text(shiftLabel(c))),
              ],
              onChanged: (v) =>
                  setState(() => currentShift = v ?? currentShift),
            ),
            gap,
            DropdownButtonFormField<String?>(
              isExpanded: true,
              key: ValueKey('current-$currentDuty'),
              initialValue: currentDuty,
              decoration: const InputDecoration(
                labelText: 'Current Duty Category',
              ),
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('General / Unassigned'),
                ),
                for (final c in dutyChoices(currentDuty))
                  DropdownMenuItem<String?>(
                    value: c,
                    child: Text(c, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) => setState(() => currentDuty = v),
            ),
            gap,
            DropdownButtonFormField<String>(
              isExpanded: true,
              key: ValueKey('requested-$requestedShift'),
              initialValue: requestedShift,
              decoration: const InputDecoration(labelText: 'Requested Shift'),
              items: [
                const DropdownMenuItem(
                  value: '',
                  child: Text('-- Keep Current Shift --'),
                ),
                for (final c in shiftCodes)
                  DropdownMenuItem(value: c, child: Text(shiftLabel(c))),
              ],
              onChanged: (v) => setState(() => requestedShift = v ?? ''),
            ),
            gap,
            DropdownButtonFormField<String?>(
              isExpanded: true,
              initialValue: requestedDuty,
              decoration: const InputDecoration(
                labelText: 'Requested Duty Point',
              ),
              items: [
                const DropdownMenuItem<String?>(
                  value: null,
                  child: Text('Any suitable duty point'),
                ),
                for (final c in widget.dutyCategories)
                  DropdownMenuItem<String?>(
                    value: c,
                    child: Text(c, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: (v) => setState(() => requestedDuty = v),
            ),
            gap,
            TextFormField(
              controller: reason,
              minLines: 3,
              maxLines: 5,
              maxLength: 1000,
              decoration: const InputDecoration(
                labelText: 'Reason for Infeasibility *',
                hintText: 'Explain why this assignment is not feasible (e.g. urgent court appearance, sudden sickness, bereavement, transportation issue)',
                alignLabelWithHint: true,
              ),
              validator: (v) =>
                  (v ?? '').trim().isEmpty ? 'Enter a reason' : null,
            ),
            if (problem != null)
              Text(problem!, style: const TextStyle(color: Colors.red)),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: submit,
          child: const Text('Submit Change Request'),
        ),
      ],
    );
  }
}
