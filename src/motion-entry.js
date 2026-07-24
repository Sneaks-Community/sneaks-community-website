// Bundle entry for public/lib/motion.js: re-exports only the Motion API the site
// uses, so esbuild can tree-shake the rest of the library away.
export { animate, inView, scroll, stagger } from 'motion';
