export const adminPath = '/access.html';
export const adminTabs = { adminRoles: 'roles', adminAccess: 'accounts', adminAudit: 'audit' };

const filePaths = { files: '/files.html', 'files-admin': '/files-admin.html' };

export function workspacePath(key) {
  if (Object.hasOwn(adminTabs, key)) return adminPath + '#' + key;
  if (Object.hasOwn(filePaths, key)) return filePaths[key];
  return null;
}

export function workspacePathPage(url) {
  const hash = url.hash.slice(1);
  if (url.pathname === adminPath && Object.hasOwn(adminTabs, hash)) return hash;
  return Object.keys(filePaths).find((key) => filePaths[key] === url.pathname);
}

export function accountReturnPath(value) {
  if (!value?.startsWith('/')) return null;
  let url;
  try {
    url = new URL(value, location.origin);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  if (
    workspacePathPage(url) ||
    (url.pathname === '/fabric.html' && url.searchParams.get('floor') === '1')
  ) {
    return url.pathname + url.search + url.hash;
  }
  return null;
}

export function followWorkspaceLink(event, navigate) {
  if (
    !navigate ||
    event.defaultPrevented ||
    event.button ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  navigate();
}
