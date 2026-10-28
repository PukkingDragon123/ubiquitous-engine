// The Sand King's guidance (a light, skippable tutorial) and royal quips.
import { pick, rnd } from '../core/math.js';

const QUIPS = [
  'I am the rightful king of this entire beach!',
  'Does anyone know whose ring this was? …No? Excellent.',
  'Mind the tide, my loyal grains!',
  'A king must never get his feet wet. Ever.',
  'More towers! Taller towers! TALLER!',
  'I can hear the crabs whispering. They whisper "pinch".',
  'Remember: wet sand stands, dry sand slides!',
  'Fetch me a shell. A shiny one. For no reason.',
  'If the sea takes my castle, I shall build a bigger one. Out of you.',
  'Is it lunchtime? Sandlings don\'t eat. Never mind.',
];

const BATTLE = [
  'Hold the line! The line in the sand!',
  'Fling them back into the sea!',
  'Not the castle! Anything but the castle!',
  'Archers! Point the pointy end at the crabs!',
  'I\'m perfectly calm! THIS IS ME BEING CALM!',
];

export class Tutorial {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.step = 0;
    this.t = 0;
    this.active = false;
    this.done = new Set();
    this.quipTimer = 40;
    this.summoned = false;
    this.dug = 0;
    const ev = game.events;
    ev.on('play', (skip) => {
      this.active = true;
      this.step = 0;
      this.t = skip ? 1.5 : 2.5;
    });
    ev.on('summoned', () => { this.summoned = true; });
    ev.on('dig', (x, z, v) => { this.dug += v; });
    ev.on('buildingPlaced', (b) => { if (b.type === 'camp') this._flag('campPlaced'); });
    ev.on('buildingComplete', (b) => {
      if (b.type === 'camp' && !this.done.has('campBuilt')) {
        this._flag('campBuilt');
        this.king('A camp! Click it to train more workers. More hands, more castles!');
      }
      if (b.type === 'tower' && !this.done.has('towerBuilt')) {
        this._flag('towerBuilt');
        this.king('A tower! Archers will climb up and pelt the crabs. Train some there!');
      }
    });
    ev.on('warning', () => {
      if (this.game.director.wave === 0) this.king('THE STOPWATCH! When it stops, the sea rises — and the crabs come with it! Build an Archer Tower!', { shout: false, duration: 6 });
      else this.king(pick(['The stopwatch returns! Prepare the defences!', 'Again?! Back to your posts!', 'Tick tock, tick tock… I hate that sound.']));
    });
    ev.on('waveStart', (n) => {
      setTimeout(() => this.king(n === 1 ? 'TO ARMS! Protect the kingdom! And especially me!' : pick(BATTLE), { shout: n === 1 }), 1500);
    });
    ev.on('waveCleared', (n) => {
      setTimeout(() => this.king(n === 1 ? 'We survived! The sea leaves gifts behind — look for bottles with blueprints!' : pick(['Ha! Back to the sea with you!', 'Victory! Someone fix my castle.', 'I knew we would win. I was never worried. At all.'])), 2500);
    });
    ev.on('bossArrive', (c) => setTimeout(() => {
      if (c.type === 'kraken') this.king('An octopus. In a HAT. Hack at its arms when they slap the sand — archers, aim for the head!', { duration: 5 });
      else this.king('That… is a VERY large crab. And that is a VERY large fork.', { duration: 4 });
    }, 3200));
    ev.on('krakenSever', () => { if (!this._calamari) { this._calamari = true; setTimeout(() => this.king('HA! Calamari for everyone!', { shout: true, duration: 2.5 }), 900); } });
    ev.on('kingStands', () => this.king(pick(['Unhand my kingdom, you crustacean!', 'Have at thee!', 'Royal scepter, ACTIVATE!']), { shout: true, duration: 2 }));
    ev.on('blueprintUnlocked', (bp) => setTimeout(() => this.king('A new blueprint! Open the bottles to build it.'), 3200));
    ev.on('grab', (o) => {
      if (o === this.game.king) setTimeout(() => this.king(pick(['PUT ME DOWN!', 'I am NOT a toy!', 'Wheee— I mean, how dare you!']), { shout: true, duration: 1.8 }), 200);
    });
  }

  _flag(k) { this.done.add(k); }

  king(text, opts = {}) {
    const k = this.game.king;
    if (!k || !k.alive) return;
    this.ui.say(k, text, { king: true, who: 'The Sand King', duration: opts.duration, shout: opts.shout, lift: 0.55 });
  }

  update(dt) {
    const game = this.game;
    if (!this.active || game.state !== 'play') return;
    this.t -= dt;
    // royal quips when nothing else is going on
    this.quipTimer -= dt;
    if (this.quipTimer <= 0) {
      this.quipTimer = rnd(45, 80);
      if (this.step >= 6 && game.director.phase !== 'warning') this.king(game.director.phase === 'battle' ? pick(BATTLE) : pick(QUIPS));
    }
    if (this.t > 0) return;
    const belt = this.ui.toolEls;
    switch (this.step) {
      case 0:
        this.king('Commander! Our kingdom needs hands. Open the bottles from the sea and build a Worker Camp!', { duration: 7 });
        belt.bottle.classList.add('pulse');
        this.step = 1;
        this.t = 2;
        break;
      case 1:
        if (this.done.has('campPlaced')) {
          belt.bottle.classList.remove('pulse');
          this.king('Splendid! Our workers will haul shells and driftwood over and build it.', { duration: 4.5 });
          this.step = 2;
          this.t = 6;
        } else if (this.t < -25) {
          this.ui.toast('Tip: press 5 or click the bottle to see blueprints', '');
          this.t = 0;
          this.step = 1.5;
        }
        break;
      case 1.5:
        if (this.done.has('campPlaced')) { this.step = 1; this.t = 0; }
        break;
      case 2:
        this.king('Hold the mouse down on the sand to call workers to that spot!', { duration: 5 });
        this.step = 3;
        this.t = 3;
        break;
      case 3:
        if (this.summoned || this.t < -20) {
          this.king(this.summoned ? 'Look at them go! Workers grab whatever the sea washes up.' : 'Our sandlings gather shells the sea washes up. Every shell counts!', { duration: 4.5 });
          this.step = 4;
          this.t = 8;
        }
        break;
      case 4:
        this.king('Now take the shovel and dig a moat. Waves fill it with water — crabs hate swimming!', { duration: 6 });
        belt.shovel.classList.add('pulse');
        this.step = 5;
        this.t = 3;
        break;
      case 5:
        if (this.dug > 1.5 || this.t < -30) {
          belt.shovel.classList.remove('pulse');
          this.king(this.dug > 1.5 ? 'Magnificent digging! Damp sand holds a wall; dry sand slides.' : 'Build huts for more sandlings, and towers to defend us!', { duration: 5 });
          this.step = 6;
          this.t = 6;
        }
        break;
      case 6:
        this.king('Psst — right-click any sandling to become them. Even me. Especially me.', { duration: 5 });
        this.step = 7;
        this.t = 9999;
        break;
      default: break;
    }
  }
}
