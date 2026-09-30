# 代码高亮测试

## JavaScript

```javascript
// ES6+ 语法
class Calculator {
  constructor(initialValue = 0) {
    this.value = initialValue;
  }

  add(n) {
    this.value += n;
    return this;
  }

  multiply(n) {
    this.value *= n;
    return this;
  }

  async calculateAsync(fn) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(fn(this.value)), 100);
    });
  }
}

const calc = new Calculator(10);
calc.add(5).multiply(2);
console.log(calc.value); // 30

// 箭头函数和解构
const users = [
  { name: 'Alice', age: 25 },
  { name: 'Bob', age: 30 },
];

const names = users.map(({ name }) => name);
console.log(names); // ['Alice', 'Bob']
```

## TypeScript

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'user' | 'guest';
}

type UserResponse = Pick<User, 'id' | 'name'>;

class UserService<T extends User> {
  private users: T[] = [];

  add(user: T): void {
    this.users.push(user);
  }

  findById(id: number): T | undefined {
    return this.users.find(u => u.id === id);
  }

  filterByRole(role: T['role']): T[] {
    return this.users.filter(u => u.role === role);
  }
}

const service = new UserService<User>();
service.add({
  id: 1,
  name: 'Alice',
  email: 'alice@example.com',
  role: 'admin',
});
```

## Python

```python
from typing import List, Optional
from dataclasses import dataclass
from functools import reduce

@dataclass
class Student:
    name: str
    grade: int
    scores: List[float]

    @property
    def average(self) -> float:
        return sum(self.scores) / len(self.scores) if self.scores else 0.0

def calculate_class_average(students: List[Student]) -> float:
    if not students:
        return 0.0
    total = reduce(lambda acc, s: acc + s.average, students, 0.0)
    return total / len(students)

# 列表推导式
students = [
    Student("Alice", 10, [95, 87, 92]),
    Student("Bob", 10, [78, 85, 90]),
    Student("Charlie", 11, [88, 92, 95]),
]

honors = [s.name for s in students if s.average >= 90]
print(f"Honor students: {honors}")
```

## Rust

```rust
use std::collections::HashMap;

#[derive(Debug, Clone)]
struct Matrix {
    rows: usize,
    cols: usize,
    data: Vec<Vec<f64>>,
}

impl Matrix {
    fn new(rows: usize, cols: usize) -> Self {
        Self {
            rows,
            cols,
            data: vec![vec![0.0; cols]; rows],
        }
    }

    fn multiply(&self, other: &Matrix) -> Result<Matrix, String> {
        if self.cols != other.rows {
            return Err("Matrix dimensions don't match".to_string());
        }

        let mut result = Matrix::new(self.rows, other.cols);
        for i in 0..self.rows {
            for j in 0..other.cols {
                let mut sum = 0.0;
                for k in 0..self.cols {
                    sum += self.data[i][k] * other.data[k][j];
                }
                result.data[i][j] = sum;
            }
        }
        Ok(result)
    }
}

fn main() {
    let mut scores: HashMap<String, Vec<f64>> = HashMap::new();
    scores.entry("Alice".to_string()).or_insert_with(Vec::new).push(95.0);
    scores.entry("Alice".to_string()).or_insert_with(Vec::new).push(87.0);

    for (name, grades) in &scores {
        let avg: f64 = grades.iter().sum::<f64>() / grades.len() as f64;
        println!("{}: {:.1}", name, avg);
    }
}
```

## HTML

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>示例页面</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <nav>
      <ul>
        <li><a href="#home">首页</a></li>
        <li><a href="#about">关于</a></li>
      </ul>
    </nav>
  </header>

  <main>
    <article>
      <h1>文章标题</h1>
      <p>段落内容...</p>
      <img src="image.jpg" alt="图片描述" loading="lazy">
    </article>
  </main>

  <script src="app.js" type="module"></script>
</body>
</html>
```

## CSS

```css
:root {
  --primary-color: #3b82f6;
  --spacing-unit: 8px;
}

.container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: calc(var(--spacing-unit) * 2);
  padding: var(--spacing-unit);
}

.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s ease;
}

.card:hover {
  transform: translateY(-4px);
}

@media (prefers-color-scheme: dark) {
  .card {
    background: #1f2937;
    color: white;
  }
}
```

## Bash

```bash
#!/bin/bash

# 变量定义
PROJECT_NAME="reader"
VERSION="1.0.0"
BUILD_DIR="./build"

# 函数
build_project() {
    echo "Building ${PROJECT_NAME} v${VERSION}..."
    
    if [ -d "$BUILD_DIR" ]; then
        rm -rf "$BUILD_DIR"
    fi
    
    mkdir -p "$BUILD_DIR"
    
    for file in src/*.ts; do
        echo "Compiling $file..."
        tsc "$file" --outDir "$BUILD_DIR"
    done
    
    echo "Build complete!"
}

# 条件判断
if [ "$1" = "--clean" ]; then
    echo "Cleaning build directory..."
    rm -rf "$BUILD_DIR"
fi

# 循环
for i in {1..5}; do
    echo "Processing item $i of 5"
    sleep 1
done

# 调用函数
build_project
echo "Done!"
```

## JSON

```json
{
  "name": "reader",
  "version": "1.0.0",
  "description": "轻量级 Markdown/LaTeX 阅读器",
  "main": "index.js",
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "markdown-it": "^14.0.0",
    "katex": "^0.16.0",
    "shiki": "^1.0.0"
  },
  "devDependencies": {
    "svelte": "^4.2.0",
    "@sveltejs/kit": "^2.0.0",
    "typescript": "^5.0.0"
  }
}
```

## YAML

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
    
    steps:
      - uses: actions/checkout@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
      - run: npm ci
      - run: npm run build
      - run: npm test
```

## SQL

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);

SELECT 
    u.username,
    COUNT(p.id) AS post_count,
    MAX(p.created_at) AS last_post
FROM users u
LEFT JOIN posts p ON u.id = p.user_id
WHERE u.created_at > '2024-01-01'
GROUP BY u.username
HAVING COUNT(p.id) > 5
ORDER BY post_count DESC
LIMIT 10;
```

## Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```
