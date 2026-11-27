import * as THREE from 'three';
// The title screen's typeface, bundled with the game so it works offline.
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import './styles.css';
import { Scene } from './render/scene';
import { GameView } from './render/view';
import { Controller } from './ui/controller';
import { fitShell } from './ui/shell';

const el = (id: string): HTMLElement => document.getElementById(id)!;

// First, before anything is laid out: in the iPad app the page fills the screen exactly.
fitShell();
const scene = new Scene(el('scene') as HTMLCanvasElement);
const view = new GameView(scene, el('floaters'));
const game = new Controller(scene, view, {
  hud: el('hud'),
  top: el('topbar'),
  side: el('sidebar'),
  log: el('log'),
  card: el('unitcard'),
  harvest: el('harvest'),
  overlay: el('overlay'),
  toast: el('toast'),
  minimap: el('minimap') as HTMLCanvasElement,
  scores: el('scores'),
  home: el('home'),
});

view.start();
window.addEventListener('resize', () => scene.resize());
game.showHome();

// A handle for poking at a running game from the devtools console.
if (import.meta.env.DEV) Object.assign(window, { nc: { scene, view, game, THREE } });
