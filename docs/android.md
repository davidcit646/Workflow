# Android Setup (Capacitor + Play Billing)

This repo is Electron-first. Android support is provided via Capacitor plus a native billing plugin.

## 1) Install deps

```
npm install
```

## 2) Create the Android project

```
npx cap add android
npx cap sync android
```

Capacitor reads `capacitor.config.json` and uses `web/` as the webDir.

## 3) Enable file storage (local folder)

The web app writes data to `Documents/Workflow` when the Capacitor Filesystem plugin is available.

Make sure the filesystem plugin is included:

```
npx cap sync android
```

## 4) Add Play Billing

### a) Copy the plugin

Copy `native/android/WorkflowBillingPlugin.kt` into your Android project:

```
android/app/src/main/java/com/workflow/tracker/WorkflowBillingPlugin.kt
```

If your package name differs from `com.workflow.tracker`, update the `package` line accordingly.

### b) Register the plugin

In `android/app/src/main/java/.../MainActivity.java` (or `.kt`), register the plugin:

```
registerPlugin(WorkflowBillingPlugin.class);
```

### c) Add the billing dependency

In `android/app/build.gradle`, add the Play Billing library dependency:

```
implementation "com.android.billingclient:billing:6.1.0"
```

Update the version to the latest supported by Google Play if needed.

### d) Add the billing permission

In `android/app/src/main/AndroidManifest.xml` add:

```
<uses-permission android:name="com.android.vending.BILLING" />
```

## 5) Configure product IDs

The UI uses these default SKUs:

- `support_dev_1`
- `support_dev_5`
- `support_dev_10`

Update the SKUs in `web/index.html` if you use different IDs.

## 6) Build

Open Android Studio from the `android/` folder and build an AAB for Play Console.

## Notes

- The donation flow is implemented as a **consumable** purchase so users can donate multiple times.
- Data is encrypted locally and stored in `Documents/Workflow` when possible.
