# Owned device release

Owned device only: 371DE15B-3876-4931-8C6B-31C5467C215F, fresh iPhone 17, iOS 27.0. UUID reported before driving. Xcode DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer on every CoreSimulator/build/test command.

Initial guest preference reads: PreferredContentSizeCategoryName missing from com.apple.Accessibility; com.apple.iphonesimulator domain missing. simctl ui content_size returned large. During testing only this device's content_size was set to large and its guest ConnectHardwareKeyboard key to false. No global host preferences changed.

Release completed successfully: simctl ui UUID content_size large; guest defaults delete com.apple.iphonesimulator ConnectHardwareKeyboard (restore original absent key); content_size readback large; simctl shutdown UUID; simctl delete UUID. Final JSON device inventory check: Owned simulator still present: False. No second fresh simulator created. No physical device deployed.

Original17 1EDC5D9A-7E25-432A-B5B1-9A8B702306A7, E1C6B89D-922E-41AC-8148-4C81C57BEE64 and R39 7E1D7979-7307-4C53-8466-BB41154B383C were not driven, altered, shut down, or deleted. Protected working copies and performance artifacts were not edited/read directly. Normal git operations used this isolated worktree's repository metadata.

PR782 registry checked: linked/open, watching false. unwatch_pull_request returned wasWatching=false, watching=false. PR branch/source unchanged; no push/merge/cherry-pick.
