import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';
import { readTheme, applyTheme } from './theme.js';

applyTheme(readTheme());
mount(App, { target: document.getElementById('app') });
