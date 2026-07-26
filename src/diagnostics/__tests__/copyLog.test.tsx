import { fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { Alert } from 'react-native';

import DiagnosticsScreen from '../../../app/diagnostics';
import { DbProvider } from '../../db/DbProvider';
import { createNodeAdapter, type NodeDbAdapter } from '../../db/nodeAdapter';
import { createBin, insertItem } from '../../db/queries';
import { runMigrations } from '../../db/schema';
import { logEvent, setLoggingEnabled } from '../events';

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable } = require('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Pressable>{children}</Pressable>,
    useFocusEffect: () => undefined,
  };
});

/**
 * The button that exists because sharing a zip could not be relied on: the
 * export needs a share target willing to take 100 MB, and when it fails there
 * is no way to report why. This is the path that always works, so it is the
 * one that must not break.
 */
describe('Copy log', () => {
  let db: NodeDbAdapter;
  const alerted = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const copyToClipboard = jest
    .spyOn(Clipboard, 'setStringAsync')
    .mockImplementation(() => Promise.resolve(true));

  beforeEach(() => {
    copyToClipboard.mockClear();
    alerted.mockClear();
    db = createNodeAdapter(':memory:');
    runMigrations(db);
    setLoggingEnabled(true);
    logEvent(db, { kind: 'screen', name: '/map' });
    logEvent(db, {
      kind: 'crash',
      name: 'previous_session_died',
      detail: { message: 'The app restarted without shutting down' },
    });
    const bin = createBin(db, { name: 'Fixings', shortCode: 'B-001' });
    insertItem(db, { binId: bin.id, name: 'Deck screws', category: 'fastener' });
  });
  afterEach(() => db.close());

  const renderScreen = () =>
    render(
      <DbProvider adapter={db}>
        <DiagnosticsScreen />
      </DbProvider>,
    );

  it('puts the log on the clipboard when pressed', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('diagnostics-copy-log'));

    expect(copyToClipboard).toHaveBeenCalledTimes(1);
    const copied = copyToClipboard.mock.calls[0][0];
    expect(copied).toContain('Binocular');
    expect(copied).toContain('--- crashes (1) ---');
    expect(copied).toContain('The app restarted without shutting down');
    expect(copied).toContain('screen//map');
  });

  it('never copies the inventory — a clipboard is not the place for it', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('diagnostics-copy-log'));
    const copied = copyToClipboard.mock.calls[0][0];
    expect(copied).not.toContain('Deck screws');
    expect(copied).not.toContain('Fixings');
  });

  it('confirms the copy, so it is obvious it worked', async () => {
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('diagnostics-copy-log'));
    expect(alerted).toHaveBeenCalledWith('Log copied', expect.stringContaining('clipboard'));
  });
});
