# BabajagaBoB Android

Native Android-Client für Android 11 bis Android 16.

## Kompatibilität

- minSdk 30 (Android 11)
- targetSdk 35
- keine Root-/ADB-/Geräteprivilegien
- Control-Plane-Zugangsdaten werden nicht in der APK eingebettet
- Netzwerkzugriff erfolgt nur zur konfigurierten Control Plane

## Build

Aus dem Verzeichnis `android/`:

```bash
gradle :app:assembleDebug
gradle :app:assembleRelease
```

Der Release-Build ist ohne eingebetteten privaten Signaturschlüssel bewusst unsigniert. Der CI-Build erzeugt zusätzlich eine debug-signierte APK für sofortige Installation und kann mit einem hinterlegten Keystore auf einen reproduzierbaren Release-Signaturprozess erweitert werden.

## Architektur

Die APK ist der mobile Client. Die serverseitige Control Plane, Agent Runtime, Sandboxes und Worker bleiben auf der bestehenden Plattform. Dadurch werden keine Root-/Runtime-Rechte in die mobile App verlagert.
