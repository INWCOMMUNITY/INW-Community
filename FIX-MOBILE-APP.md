# Fix Mobile App (Expo) - "Cannot find module @expo/cli"

The error is caused by **corrupted node_modules** and **Windows path length limits** with pnpm's symlink structure. The project path `C:\Users\jesus\INW Community` plus pnpm's deep nesting exceeds 260 characters.

## Option 1: Move project to shorter path (recommended)

1. **Close Cursor completely**
2. Move the project to a shorter path, e.g.:
   - `C:\dev\inw`
   - `C:\proj\inw`
3. Open the project in Cursor from the new location
4. Run **Option 2** steps (clean reinstall)

## Option 2: Clean reinstall

**Close Cursor first** (to release file locks), then:

1. Open **Command Prompt as Administrator** (right‑click → Run as administrator)
2. Navigate to the project:
   ```
   cd "C:\Users\jesus\INW Community"
   ```
3. Delete node_modules:
   ```
   rmdir /s /q node_modules
   rmdir /s /q apps\mobile\node_modules
   rmdir /s /q apps\main\node_modules
   rmdir /s /q apps\admin\node_modules
   rmdir /s /q packages\database\node_modules
   rmdir /s /q packages\design-tokens\node_modules
   rmdir /s /q packages\types\node_modules
   ```
4. Reinstall:
   ```
   pnpm install
   ```
5. Start the app:
   ```
   pnpm dev:app
   ```

## Option 3: Enable Windows long paths

1. Open Registry Editor (Win+R → `regedit`)
2. Go to `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FileSystem`
3. Set `LongPathsEnabled` to `1`
4. Restart the computer

Then run **Option 2** (clean reinstall).

## If rmdir fails

Use the existing `CLEAN-REINSTALL.cmd` **outside Cursor** (close Cursor first). Right‑click it → Run as Administrator.
