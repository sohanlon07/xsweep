import './styles.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app')!;
target.replaceChildren();
mount(App, { target });
document.getElementById('source-notice')?.remove();
