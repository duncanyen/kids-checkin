// Shared page size comes from the generated business domain used by both transports.
import {PLOTS_PER_PAGE} from './direct-domain.js';
export {PLOTS_PER_PAGE};
export const PLANT_SCALE=.8;
export const PLOT_POSITIONS=Array.from({length:PLOTS_PER_PAGE},(_,i)=>({x:190+(i%3)*200,y:535+Math.floor(i/3)*175}));
