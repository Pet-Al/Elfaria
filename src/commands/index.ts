import type { ElfariaClient } from '../client.js';
import type { Command } from '../lib/types.js';
import { autoplay } from './autoplay.js';
import { clear } from './clear.js';
import { favorites } from './favorites.js';
import { filter } from './filter.js';
import { history } from './history.js';
import { loop } from './loop.js';
import { nowplaying } from './nowplaying.js';
import { pause } from './pause.js';
import { ping } from './ping.js';
import { play } from './play.js';
import { playlist } from './playlist.js';
import { queue } from './queue.js';
import { remove } from './remove.js';
import { replay } from './replay.js';
import { resume } from './resume.js';
import { seek } from './seek.js';
import { settings } from './settings.js';
import { shuffle } from './shuffle.js';
import { skip } from './skip.js';
import { skipto } from './skipto.js';
import { stop } from './stop.js';
import { volume } from './volume.js';

/**
 * The command registry (doc §2). An explicit array — type-safe and trivial to
 * audit — rather than filesystem scanning. Add a command by importing it here.
 */
export const commands: Command[] = [
  ping,
  play,
  skip,
  skipto,
  stop,
  pause,
  resume,
  queue,
  nowplaying,
  volume,
  loop,
  shuffle,
  seek,
  clear,
  remove,
  settings,
  playlist,
  autoplay,
  filter,
  history,
  replay,
  favorites,
];

/** Populate the client's command Collection used by the router. */
export function loadCommands(client: ElfariaClient): void {
  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }
}
