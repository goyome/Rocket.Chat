import { Permissions } from '../../models';

// TODO: remove
Permissions.create('post-readonly', ['admin', 'owner', 'moderator']);
Permissions.create('set-readonly', ['admin', 'owner']);
Permissions.create('set-react-when-readonly', ['admin', 'owner']);
