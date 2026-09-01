Write the narrative half of the run report in `runReport.markdown`: what the change actually does, why the plan took the shape it did, what you judge to be weak or unfinished about it, and what a reader should look at first. The host renders the request, the plan and its steps, the build summary and candidate SHA, every phase outcome, every gate row, the review, the final lifecycle state and the cost from its own evidence, and places your narrative among them. Do not restate any of those, do not open with a title, and do not write a section saying what is still pending — the host's own sections answer that.

Project documentation is optional. Keep any repository edit inside the exact write boundary appended below. If nothing inside that boundary is stale, edit nothing and return empty change arrays. Never choose a nearby file merely because it is writable.

Previous phase envelope:
{previous_envelope}

Return only an envelope satisfying this host-generated contract:
{output_schema}
