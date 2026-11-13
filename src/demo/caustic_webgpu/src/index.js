import { startExperiment } from './app.js';

const status = document.querySelector('#status');

startExperiment().catch((error) => {
  console.error(error);
  if (!status) return;
  status.style.display = 'grid';
  status.innerHTML = '';
  const message = document.createElement('div');
  message.textContent = error && error.message ? error.message : String(error);
  const hint = document.createElement('p');
  hint.innerHTML = 'No WebGPU here? Try the <a href="../caustic/index.html">WebGL version of Caustic</a>.';
  message.append(hint);
  status.append(message);
});
