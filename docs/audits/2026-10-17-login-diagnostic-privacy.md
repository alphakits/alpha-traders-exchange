# Login diagnostic privacy

The optional local authentication diagnostic logged a body preview after a
format-specific password replacement. Spaced JSON, form-encoded credentials
and malformed JSON could expose submitted secrets. Native JSON parse errors
can also include the malformed body in their message. Production diagnostic
gating already existed; this defect affected the enabled diagnostic path.

Login diagnostics now record body length and the parser error name only. They
never log the body, raw parser message or caller-supplied content-type string.
Controlled requests reproduced three failures before the repair; the final
login/structured-log run passed all 31 assertions, including spaced JSON,
escaped strings, form bodies and malformed input. No real credentials or
provider requests were used.
