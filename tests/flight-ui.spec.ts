import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function enterFlight(page: Page, challenge = '高山速降') {
 await page.addInitScript(()=>localStorage.setItem('aero-formula.language','zh'));
 await page.goto('/');
 await page.getByRole('button',{name:challenge,exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
}

test('开始试飞后配平集中在圆形杆量仪表',async({page})=>{
 await enterFlight(page);
 const start=page.getByRole('button',{name:'开始试飞',exact:true});
 await start.click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 const panel=page.getByRole('region',{name:'杆量与配平',exact:true});
 await expect(panel).toBeVisible();
 const pitch=panel.getByRole('slider',{name:'升降舵配平',exact:true});
 const roll=panel.getByRole('slider',{name:'副翼配平',exact:true});
 await expect(pitch).toHaveValue('50');await expect(roll).toHaveValue('50');
 await page.keyboard.press('j');await expect(pitch).toHaveValue('45');
 await page.keyboard.press('k');await expect(pitch).toHaveValue('50');
 await page.keyboard.press('h');await expect(roll).toHaveValue('45');
 await page.keyboard.press('l');await expect(roll).toHaveValue('50');
 await page.getByRole('switch',{name:'气动图层',exact:true}).click();
 const aero=page.getByRole('complementary',{name:'实时气动数据'});
 await expect(aero.getByRole('slider',{name:'升降舵配平',exact:true})).toHaveCount(0);
 await expect(panel).toBeVisible();
});

test('T与Y切换飞行辅助，重飞复位，鸟人禁用自动配平',async({page})=>{
 await enterFlight(page);
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 const auto=page.getByRole('switch',{name:'自动升降舵配平（T）',exact:true});
 const adaptive=page.getByRole('switch',{name:'自适应杆量（Y）',exact:true});
 await expect(auto).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('t');await expect(auto).toHaveAttribute('aria-checked','true');
 await auto.click();await expect(auto).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('y');await expect(adaptive).toHaveAttribute('aria-checked','true');
 await adaptive.click();await expect(adaptive).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('t');await page.keyboard.press('y');await page.keyboard.press('r');
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await expect(auto).toHaveAttribute('aria-checked','false');await expect(adaptive).toHaveAttribute('aria-checked','false');
 await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'返回主菜单',exact:true}).click();
 await page.getByRole('button',{name:'鸟人间挑战',exact:false}).click();
 await page.getByRole('button',{name:'试飞',exact:true}).click();
 await page.getByRole('button',{name:'开始试飞',exact:true}).click();
 await page.getByRole('button',{name:'暂停',exact:true}).click();
 await expect(auto).toBeDisabled();await page.keyboard.press('t');
 await expect(auto).toHaveAttribute('aria-checked','false');
});
