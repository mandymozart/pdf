!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\LocalPdf.Viewer" "" "PDF"
  WriteRegStr SHELL_CONTEXT "Software\Classes\LocalPdf.Viewer\DefaultIcon" "" "$INSTDIR\PDF.exe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\LocalPdf.Viewer\shell\open\command" "" '"$INSTDIR\PDF.exe" "%1"'
  WriteRegBin SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "LocalPdf.Viewer" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.pdf\OpenWithProgids" "LocalPdf.Viewer"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\LocalPdf.Viewer"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
!macro customInit
  ${Unless} ${Silent}
    ReadRegStr $R0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" "InstallLocation"
    ${If} $R0 != ""
      ${If} ${FileExists} "$R0\PDF.exe"
        MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "PDF is already installed. Replace it with this version? Your saved details and signature will be kept." IDYES pdf_continue_install
        Abort
        pdf_continue_install:
      ${EndIf}
    ${EndIf}
  ${EndUnless}
!macroend
