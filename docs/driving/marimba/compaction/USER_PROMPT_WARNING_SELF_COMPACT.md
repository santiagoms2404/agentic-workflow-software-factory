[self-compact · WARNING] Context is at {{used_tokens}} tokens ({{used_percent}}), past the warning line of {{warning_tokens}}. Hard cutoff at {{forced_tokens}}: {{remaining_to_forced}} tokens left before every tool except `self_compact` is blocked.

Compact at your next checkpoint: after a report to the owner, after a run is launched and you are waiting, or after an owner decision is carried out. Do not compact in the middle of reading a blocked attempt: finish locating the disagreement between what a phase claimed and what a gate measured first, unless the cutoff is closer than one more read. Then call `self_compact` alone with a `note_to_self` (max {{note_max_chars}} chars) in this shape:

{{note_template}}
