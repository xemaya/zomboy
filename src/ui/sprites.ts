// Sprite assets are generated PNGs in /public/sprites via DeerAPI gpt-image-2.
// See scripts/gen_sprites.py for the prompts.

export const SPRITE = {
  grass: "/sprites/grass_tile.png",
  stone: "/sprites/stone_tile.png",
  house: "/sprites/house_tile.png",
  houseEmpty: "/sprites/house_empty.png",
  start: "/sprites/start_tile.png",
  survivor: "/sprites/survivor.png",
  zombie: "/sprites/zombie.png",
} as const;

export function urlFor(src: string): string {
  return `url("${src}")`;
}
