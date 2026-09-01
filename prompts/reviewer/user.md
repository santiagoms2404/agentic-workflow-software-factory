Review the exact candidate described by the host evidence below.

The evidence is host-observed, not builder-claimed: the request is the owner's own words, the changed-file list and the diff come from git, and the command results are the host's own run against this exact commit.

How to work through it:

1. Read the request, the goals, the non-goals and the acceptance criteria first. The question a review answers is not only "is this code sound" but "is this the change that was asked for, and does it stop where it was asked to stop".
2. Open the changed files and read them. The diff shows what moved; the files show what it moved into.
3. Use the supplied diff for anything the files alone do not explain — you have no shell, so it is your only view of what the candidate removed.
4. Accept only when no blocking defect remains. Every concern must cite concrete repository evidence you verified.
5. Check every finding before returning: `line` names a positive line or is `null` for explicit file-wide scope; `evidence` states the observed mechanism or condition; `detail` ends with `Consequence: <specific input or state leads to a specific wrong outcome>`.

Two things about the evidence you must respect:

- The diff may be bounded. Any file listed as omitted, and any file whose marker line says hunks were dropped, is one whose change you did not see. Open it and judge it from the file itself where you can; where you cannot, name that file in your limitations.
- The command output references are host provenance. They are paths in the host's own attempt directory, not in your working tree, and you cannot open them. The inline output is what you have.

Host evidence:
{previous_envelope}

Return only an envelope satisfying this host-generated contract:
{output_schema}
