import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { workspacePathPage } from './workspace-routes.js';

if (workspacePathPage(location)) {
  document.getElementById('access-root').id = 'fabric-root';
  void import('../fabric/app.js');
} else {
  void import('./app.js').then(({ AccessApp }) => {
    createRoot(document.getElementById('access-root')).render(createElement(AccessApp));
  });
}
