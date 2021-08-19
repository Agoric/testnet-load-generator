import fs from 'fs';
import long from 'long'; // eslint-disable-line import/no-extraneous-dependencies
import buffer from 'buffer';

import inquire from '@protobufjs/inquire'; // eslint-disable-line import/no-extraneous-dependencies

inquire.register('fs', fs);
inquire.register('long', long);
inquire.register('buffer', buffer);
