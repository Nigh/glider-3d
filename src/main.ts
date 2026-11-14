import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';
import { installInputOnlyFocus } from './focus-policy';
const target = document.getElementById('app')!;
installInputOnlyFocus(target);
mount(App,{target});
