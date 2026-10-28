import './style.css';
import * as THREE from 'three';
import { Game } from './game/Game.js';

function boot() {
  const game = new Game(document.getElementById('app'));
  // handy for poking at the kingdom from the console
  window.__game = game;
  if (game.debug) window.THREE = THREE;
  game.start();
  requestAnimationFrame(() => {
    const l = document.getElementById('loading');
    if (l) l.classList.add('done');
  });
}

boot();
