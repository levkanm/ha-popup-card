# HA Popup Card
本卡片可以把一张卡片作为入口，触发后以弹窗形式展示一张或多张卡片

# 预览

<img width="350" height="289" alt="1791468933903" src="https://github.com/user-attachments/assets/8e1a97c2-4e87-44c8-8f93-244e8bdcc685" />
<br>
<img width="350" height="337" alt="1791468851083" src="https://github.com/user-attachments/assets/a2b8028a-ed9a-4920-b14b-2f46bd1632c6" />
<br>
<img width="350" height="454" alt="1791469043548" src="https://github.com/user-attachments/assets/d82f0598-d0bf-4300-aeb9-67baec20d7a6" />

# 使用说明

添加卡片后，展开可视化编辑器中的三个版块进行设置

### 触发卡片

触发卡片是仪表盘上负责打开弹窗的入口

+ 新建时会预置一个“打开弹窗”快捷卡片

+ 点击“更换触发卡片”，可以改用其他卡片作为入口

<img width="1024" height="702" alt="Snipaste_2026-10-08_18-35-20" src="https://github.com/user-attachments/assets/15ebfff2-4dc3-40b1-9cd7-b23116d797f0" />

### 弹窗设置

+ ##### 弹窗标题

  设置弹窗顶部显示的文字，留空时不显示标题文字

+ ##### 隐藏边框

  开启后隐藏弹窗中的标题栏、背景板，仅显示弹窗内的卡片

+ ##### 隐藏标题栏

  开启后隐藏标题文字和标题栏上的操作按钮

+ ##### 打开弹窗的操作

  选择通过哪种手势打开弹窗：点击、长按、双击

  选中的手势用于打开弹窗，其他手势仍会交由触发卡片处理

+ ##### 接管点击操作

  开启后会接管触发卡片的点击流程，让无法捕获标准点击事件的卡片也能触发弹窗

+ ##### 额外排除区域

  接管点击操作开启时，此项用于排除触发卡片中的局部区域，点击这些区域时会保留触发卡片原有操作，不用于打开弹窗。

  此项适合需要保留开关、滑块或其他局部操作的卡片。

+ ##### 显示跳转按钮

  开启后会在弹窗右上角显示跳转按钮，点击后跳转至指定路径

+ ##### 跳转路径

  设置跳转按钮的跳转路径

<img width="1023" height="891" alt="Snipaste_2026-10-08_18-36-33" src="https://github.com/user-attachments/assets/2cd9da0d-63ae-4981-8235-2ed49735343f" />

### 弹窗卡片

+ ##### 弹窗预览

  实时预览弹窗内容

+ ##### 卡片配置

  使用卡片列表编辑器添加、调整顺序或移除弹窗中的卡片

  可添加多张卡片，支持嵌套

<img width="1023" height="890" alt="Snipaste_2026-10-08_18-40-35" src="https://github.com/user-attachments/assets/e916e83e-27b9-437f-8bdc-800724394e44" />

# 安装方式

* HACS：添加自定义存储库
* 手动安装：将 popup\_card.js 下载至 /www 目录，在 编辑仪表盘 -> 管理资源 处添加 /local/popup\_card.js

# 声明

本项目使用AI编程，已经过基础功能测试，但仍无法保证完全适配所有场景。使用本项目产生的任何风险由使用者自行承担。
