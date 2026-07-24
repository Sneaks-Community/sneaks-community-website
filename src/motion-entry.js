// Bundle entry for public/lib/motion.js: pulls in only the Motion API the site uses
// so esbuild can tree-shake the rest away.
import { animate, inView, scroll, stagger } from 'motion';

window.Motion = { animate, inView, scroll, stagger };
