import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-semi-condensed/600.css';
import '@fontsource/barlow-semi-condensed/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles.css';
import './parts/catalog';
import { mount as mountInteraction } from './ui/interaction';
import { mount as mountArduino } from './code/arduino';
import { mount as mountProjects } from './app/projects';
import { registerSW } from 'virtual:pwa-register';

// A ordem importa: o catálogo de peças primeiro; a abertura do projeto por último.
mountInteraction();
mountArduino();
mountProjects();

registerSW({ immediate: true });
