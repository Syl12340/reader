# LaTeX 数学公式测试

## 行内公式

简单的行内公式：$E = mc^2$

带下标的公式：$x_i + y_j = z_{i+j}$

带上下标的公式：$a_n^2 + b_n^2 = c_n^2$

希腊字母：$\alpha + \beta = \gamma$，$\pi \approx 3.14159$

分数：$\frac{a}{b} + \frac{c}{d} = \frac{ad + bc}{bd}$

根号：$\sqrt{x^2 + y^2}$，$\sqrt[3]{x}$

求和：$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$

积分：$\int_0^1 x^2 dx = \frac{1}{3}$

极限：$\lim_{x \to 0} \frac{\sin x}{x} = 1$

矩阵：
$$
\begin{pmatrix}
a & b \\
c & d
\end{pmatrix}
$$

---

## 块级公式

### 二次公式

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

### 欧拉公式

$$
e^{i\pi} + 1 = 0
$$

### 高斯积分

$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$

### 泰勒展开

$$
e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!} = 1 + x + \frac{x^2}{2!} + \frac{x^3}{3!} + \cdots
$$

### 傅里叶变换

$$
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x) e^{-2\pi i x \xi} dx
$$

### 矩阵运算

$$
\begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
\times
\begin{bmatrix}
a \\
b \\
c
\end{bmatrix}
=
\begin{bmatrix}
a + 2b + 3c \\
4a + 5b + 6c \\
7a + 8b + 9c
\end{bmatrix}
$$

### 分段函数

$$
f(x) = \begin{cases}
x^2 & \text{if } x \geq 0 \\
-x^2 & \text{if } x < 0
\end{cases}
$$

---

## 混合内容

设 $a > 0$ 且 $b \neq 0$，则一元二次方程 $ax^2 + bx + c = 0$ 的解为：

$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$

其中判别式 $\Delta = b^2 - 4ac$ 决定了根的性质：
- 当 $\Delta > 0$ 时，方程有两个不相等的实数根
- 当 $\Delta = 0$ 时，方程有两个相等的实数根
- 当 $\Delta < 0$ 时，方程有两个共轭复数根

---

## 货币测试（不应被解析为公式）

价格：$100、$29.99、$1,234.56

美元符号：$USD、$CNY

---

## 转义测试

转义的美元符号：\$这不是公式\$

双美元符号：$$ 这不是块级公式 $$
