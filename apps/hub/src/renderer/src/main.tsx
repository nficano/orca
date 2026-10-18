import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../../../docs/design/tokens.css';
import { App, useSystemTheme } from './App';
import './app.css';
import { QuickAnswer } from './QuickAnswer';

/** One renderer bundle, two windows: the tray popover and, at #quick-answer, the quick-answer panel. */
const isQuickAnswer = window.location.hash === '#quick-answer';

function QuickAnswerWindow() {
  useSystemTheme();
  return <QuickAnswer bridge={window.orca} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isQuickAnswer ? <QuickAnswerWindow /> : <App bridge={window.orca} />}</StrictMode>,
);
