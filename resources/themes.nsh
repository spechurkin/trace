; Install Clubs before the first launch. Existing theme folders belong to the user.
!macro customInstall
  IfFileExists "$INSTDIR\themes\clubs\*.*" trace_clubs_installed
  IfFileExists "$INSTDIR\themes\clubs" trace_clubs_installed
  SetOutPath "$INSTDIR\themes\clubs"
  SetOverwrite off
  File "${BUILD_RESOURCES_DIR}\themes\clubs\theme.json"
  File "${BUILD_RESOURCES_DIR}\themes\clubs\style.css"
  SetOverwrite on
  SetOutPath "$INSTDIR"
  trace_clubs_installed:
!macroend

; electron-builder normally removes all of $INSTDIR, including user themes.
; Stage application files using its existing rollback helpers, skipping themes.
!macro customRemoveFiles
  SetOutPath $TEMP
  CreateDirectory "$PLUGINSDIR\old-install"
  FindFirst $R1 $R2 "$INSTDIR\*.*"
  trace_stage_loop:
    StrCmp $R2 "" trace_stage_done
    StrCmp $R2 "." trace_stage_next
    StrCmp $R2 ".." trace_stage_next
    StrCmp $R2 "themes" trace_stage_next
    IfFileExists "$INSTDIR\$R2\*.*" trace_stage_directory trace_stage_file
  trace_stage_directory:
    CreateDirectory "$PLUGINSDIR\old-install\$R2"
    Push "\$R2"
    Call un.atomicRMDir
    Pop $R0
    StrCmp $R0 "0" trace_stage_next trace_stage_failed
  trace_stage_file:
    ClearErrors
    Rename "$INSTDIR\$R2" "$PLUGINSDIR\old-install\$R2"
    StrCmp $R2 "${UNINSTALL_FILENAME}" 0 +2
    ClearErrors
    IfErrors trace_stage_failed
  trace_stage_next:
    FindNext $R1 $R2
    Goto trace_stage_loop
  trace_stage_failed:
    FindClose $R1
    Push ""
    Call un.restoreFiles
    Pop $R0
    Abort "Cannot replace application files. Close Trace and try again."
  trace_stage_done:
    FindClose $R1
    ; Only empty application directories remain. Never recurse into themes.
    FindFirst $R1 $R2 "$INSTDIR\*.*"
  trace_cleanup_loop:
    StrCmp $R2 "" trace_cleanup_done
    StrCmp $R2 "." trace_cleanup_next
    StrCmp $R2 ".." trace_cleanup_next
    StrCmp $R2 "themes" trace_cleanup_next
    RMDir /r "$INSTDIR\$R2"
    Delete "$INSTDIR\$R2"
  trace_cleanup_next:
    FindNext $R1 $R2
    Goto trace_cleanup_loop
  trace_cleanup_done:
    FindClose $R1
    ; Non-recursive removal leaves the themes folder and its files untouched.
    RMDir "$INSTDIR"
!macroend
