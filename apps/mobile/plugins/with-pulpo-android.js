const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

// Resource aliases keep RN transcript surfaces in the same wallpaper-derived
// tonal family as the native Compose controls, and follow Android night mode.
module.exports = function withPulpoAndroid(config) {
  config = withMainApplication(config, (config) => {
    // Expo's host factory defaults to React Android's library build flag, which
    // can be false even in a debug app using prebuilt React Native artifacts.
    const source = config.modResults.contents;
    if (!source.includes('useDevSupport = BuildConfig.DEBUG')) {
      config.modResults.contents = source.replace('context = applicationContext,', 'context = applicationContext,\n      useDevSupport = BuildConfig.DEBUG,');
    }
    return config;
  });
  return withDangerousMod(config, ['android', async (config) => {
    const root = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res');
    const palettes = {
      values: { surface: '#FFFBFE', container: '#F3EDF7', text: '#1C1B1F', secondary: '#49454F', outline: '#CAC4D0', primary: '#6750A4', on_primary: '#FFFFFF', error: '#B3261E' },
      'values-night': { surface: '#1C1B1F', container: '#211F26', text: '#E6E1E5', secondary: '#CAC4D0', outline: '#49454F', primary: '#D0BCFF', on_primary: '#381E72', error: '#F2B8B5' },
      'values-v31': { surface: '@android:color/system_neutral1_10', container: '@android:color/system_neutral1_50', text: '@android:color/system_neutral1_900', secondary: '@android:color/system_neutral2_700', outline: '@android:color/system_neutral2_200', primary: '@android:color/system_accent1_600', on_primary: '@android:color/system_accent1_0', error: '#B3261E' },
      'values-night-v31': { surface: '@android:color/system_neutral1_900', container: '@android:color/system_neutral1_800', text: '@android:color/system_neutral1_100', secondary: '@android:color/system_neutral2_200', outline: '@android:color/system_neutral2_700', primary: '@android:color/system_accent1_200', on_primary: '@android:color/system_accent1_800', error: '#F2B8B5' },
    };
    for (const [qualifier, colors] of Object.entries(palettes)) {
      await fs.mkdir(path.join(root, qualifier), { recursive: true });
      await fs.writeFile(path.join(root, qualifier, 'pulpo_colors.xml'), '<resources>\n' + Object.entries(colors).map(([name, value]) => `  <color name="pulpo_${name}">${value}</color>`).join('\n') + '\n</resources>\n');
    }
    return config;
  }]);
};
