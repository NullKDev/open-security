---
id: mobile-insecure-storage
title: Mobile Insecure Data Storage
stages: [llm-scan, validate]
severity: high
description: Detects insecure local data storage in mobile apps — sensitive data (tokens, PII, credentials) stored in plaintext in SharedPreferences, UserDefaults, SQLite, external storage, or cross-platform equivalents without encryption.
classical_prepass: semgrep
---

# Mobile Insecure Data Storage

## Detection Prompt

```
You are hunting for insecure data storage in mobile applications. The risk: data stored insecurely can be extracted from a rooted/jailbroken device, via backup extraction (Android adb backup, iTunes backup), or via malicious apps with storage permissions.

FIRST — Identify the platform from file extensions:
  Android: *.kt, *.java, AndroidManifest.xml, build.gradle
  iOS: *.swift, *.m, *.h, Info.plist, Podfile
  React Native: *.tsx, *.jsx, package.json with react-native dependency
  Flutter: *.dart, pubspec.yaml

=== ANDROID ===

Open files in: app/src/main/java/, app/src/main/kotlin/

1. SharedPreferences with sensitive data:
   PATTERN: getSharedPreferences("prefs", MODE_PRIVATE).edit().putString("token", authToken)
   PATTERN: PreferenceManager.getDefaultSharedPreferences(context).getString("password", null)
   ANY SharedPreferences storing: token, password, session, auth, secret, key, credential, pin → FLAG
   SharedPreferences are stored as plaintext XML at: /data/data/<package>/shared_prefs/
   Safe alternative: EncryptedSharedPreferences from AndroidX Security Crypto

2. SQLite without encryption:
   PATTERN: SQLiteOpenHelper without SQLCipher
   openOrCreateDatabase("users.db", MODE_PRIVATE, null) — plaintext SQLite
   Room database without SupportFactory(SQLiteDatabase.openOrCreateDatabase(...)) using SQLCipher
   FLAG any Room @Database or SQLiteOpenHelper that stores: tokens, auth_tokens, user credentials

3. External Storage (world-readable before Android 10):
   PATTERN: Environment.getExternalStorageDirectory()
   PATTERN: getExternalFilesDir(null) for sensitive files (even in scoped storage, accessible to other apps with READ_EXTERNAL_STORAGE)
   FileOutputStream with path in /sdcard/, /storage/emulated/0/
   FLAG if storing tokens, PII, session files to external storage

4. World-readable files:
   PATTERN: openFileOutput("file.txt", MODE_WORLD_READABLE) — MODE_WORLD_READABLE is deprecated and dangerous
   PATTERN: FileOutputStream with permission 0644 or 0666

5. Logs with sensitive data (accessible via logcat):
   Log.d("Auth", "Token: " + authToken)
   Log.v("DEBUG", "Password: " + password)
   System.out.println("Session: " + sessionId)
   FLAG any log statement that embeds: token, password, secret, auth, session, key

=== iOS / SWIFT ===

Open files in: *.swift, *.m files

1. UserDefaults for sensitive data:
   PATTERN: UserDefaults.standard.set(token, forKey: "auth_token")
   PATTERN: UserDefaults.standard.set(password, forKey: "password")
   UserDefaults is stored at: Library/Preferences/<bundle-id>.plist — NOT encrypted
   FLAG any UserDefaults.standard.set() storing: token, password, session, auth, secret, key, credential, pin
   Safe alternative: Keychain (Security framework)

2. Keychain misuse:
   PATTERN: SecItemAdd without kSecAttrAccessible = kSecAttrAccessibleAlways → accessible even when locked
   kSecAttrAccessibleAlways — data accessible on locked device → FLAG
   kSecAttrAccessibleAlwaysThisDeviceOnly — slightly better but still accessible when locked → FLAG
   Safe: kSecAttrAccessibleWhenUnlocked, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, kSecAttrAccessibleAfterFirstUnlock

3. FileManager without data protection:
   PATTERN: FileManager.default.createFile(atPath: ..., contents: tokenData, attributes: nil)
   Missing attributes: [FileAttributeKey.protectionKey: FileProtectionType.complete]
   Plist files written without protection class
   Files in Documents/ directory (included in iTunes backup by default)

4. CoreData without encryption:
   NSPersistentContainer storing sensitive attributes without SQLCipher or file-level encryption

5. NSLog with sensitive data:
   NSLog(@"Token: %@", authToken) — appears in device logs accessible via Xcode Organizer / Console.app
   print("Password: \(password)") in Swift

=== REACT NATIVE ===

Open: *.tsx, *.jsx, *.ts, *.js files in src/ or app/

1. AsyncStorage (plaintext by default):
   PATTERN: AsyncStorage.setItem('@token', userToken)
   PATTERN: await AsyncStorage.setItem('auth_session', JSON.stringify(session))
   AsyncStorage is unencrypted on both iOS and Android
   FLAG any AsyncStorage.setItem() with key containing: token, auth, session, password, secret, credential
   Safe alternative: react-native-keychain, react-native-encrypted-storage

2. MMKV without encryption:
   MMKV.default() without encryptionKey parameter
   MMKV.withID('storage') without { encryptionKey: ... }

=== FLUTTER ===

Open: *.dart files

1. shared_preferences for sensitive data:
   PATTERN: prefs.setString('auth_token', token)
   PATTERN: prefs.setString('password', password)
   FLAG any SharedPreferences value storing auth/session/password/credential data
   Safe alternative: flutter_secure_storage

2. Sqflite without encryption:
   openDatabase('app.db') without sqlcipher
```

## Validation Prompt

```
Potential insecure data storage at {file}:{line}.

Snippet:
{snippet}

Answer ALL questions:
1. What type of data is being stored? (auth token, password, PII, session ID, or just app settings like theme/language?)
2. Is encryption applied before storage? (EncryptedSharedPreferences, SQLCipher, Keychain, flutter_secure_storage)
3. Is this the storage of a genuinely sensitive value — or just a user preference?
4. On Android: is the data on external storage (accessible to other apps) or internal storage (private to app)?
5. On iOS: is the data in UserDefaults (plist, not encrypted) or Keychain (encrypted)?

Respond with JSON: {"confirmed": true|false, "confidence": 0.0-1.0, "reason": "..."}
```

## FP Heuristics

- UserDefaults/SharedPreferences storing UI preferences (theme, language, font size, onboarding_shown) — not sensitive
- EncryptedSharedPreferences (AndroidX Security Crypto) is secure — not a finding
- flutter_secure_storage is backed by Keychain (iOS) and EncryptedSharedPreferences (Android) — secure
- react-native-keychain and react-native-encrypted-storage are secure alternatives to AsyncStorage
- Keychain items with kSecAttrAccessibleWhenUnlocked are appropriately protected
- Files in the app's internal sandbox (without external storage) on Android 10+ are scoped — other apps cannot read them
- Log statements in test files or marked `#if DEBUG` / `BuildConfig.DEBUG` only — reduced production risk
