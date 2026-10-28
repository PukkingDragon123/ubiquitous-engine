import './style.css';
import { Game } from './game/Game.js';

function boot() {
  const game = new Game(document.getElementById('app'));
  window.__game = game;
  game.start();
  requestAnimationFrame(() => {
    const l = document.getElementById('loading');
    if (l) l.classList.add('done');
  });
}

boot();
