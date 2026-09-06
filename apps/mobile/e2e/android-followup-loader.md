# Android follow-up loader

Validated September 5, 2026 on the Android 17 emulator against production.

The pending-status fix restored the first response's loader, but a second
response in an existing conversation could still show only its model header
until reasoning arrived. The transcript used Android FlatList's default native
view clipping. Keeping its native views attached restored the Compose loader
on inserted follow-up rows; normal list virtualization remains enabled.

## Native regression checks

1. Open a test conversation containing one completed response.
2. Submit a second prompt and record the interval before reasoning or answer
   content arrives. Before the fix, the assistant header appeared over an empty
   pending area. With clipping disabled, the expressive shape remained visible
   and morphed throughout that interval.
3. After completion, submit a third prompt in the same conversation without
   reloading or navigating away. Submit with the keyboard open, so the transcript
   must follow the new row while the keyboard dismisses. The loader remains
   visible until content replaces it.

The before/after checks used GPT-5.6 Luna with High reasoning and Agent mode off,
confirming this affected ordinary follow-up replies, not only Agent tool work.
This change does not alter the existing switch from the pending indicator to
reasoning/tool activity when response content arrives. Recordings remain outside
Git. Re-run these checks on a native Android build; DOM rendering cannot verify
Compose view attachment.
