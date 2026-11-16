import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import Timing from '../../src/DownhillTiming.svelte';
import { setLanguage, type Language } from '../../src/i18n';
import '../../src/style.css';

setLanguage('zh');
document.querySelector('#timing')!.classList.add('downhill-timing');
let component: ReturnType<typeof mount> | undefined;
(window as any).timing = (props: ComponentProps<typeof Timing>) => {
 if (component) unmount(component);
 component = mount(Timing, { target: document.querySelector('#timing')!, props });
 flushSync();
};
(window as any).locale = (value: Language) => { setLanguage(value); flushSync(); };
