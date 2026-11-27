import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The iPad shell. The web build in `dist/` is copied into the native app, which
 * shows it in a full-screen web view; see AGENTS.md for the build commands.
 */
const config: CapacitorConfig = {
  appId: 'com.nakustudio.NCWorldBattle',
  appName: 'NC WorldBattle',
  webDir: 'dist',
  // What shows through until the page has drawn itself, and so what the launch screen hands over
  // to: the page's own dark blue (`--bg` in styles.css), so that nothing flashes white in between.
  backgroundColor: '#0d1220',
};

export default config;
