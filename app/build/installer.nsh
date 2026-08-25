!macro customInstall
  CreateDirectory "$APPDATA\what-about-it-studio"
  IfFileExists "$APPDATA\what-about-it-studio\collaboration-remote.json" bootstrap_done_primary
  CopyFiles /SILENT "$INSTDIR\resources\collaboration-remote.json" "$APPDATA\what-about-it-studio"
bootstrap_done_primary:

  ; Keep a second product-name path populated as a compatibility fallback for
  ; Electron builds that resolve userData from productName instead of package name.
  CreateDirectory "$APPDATA\What About It Studio"
  IfFileExists "$APPDATA\What About It Studio\collaboration-remote.json" bootstrap_done_product
  CopyFiles /SILENT "$INSTDIR\resources\collaboration-remote.json" "$APPDATA\What About It Studio"
bootstrap_done_product:
!macroend
