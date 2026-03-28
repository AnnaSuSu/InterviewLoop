"""Built-in preset training domains and default core knowledge scaffolding."""
import json
from textwrap import dedent

from backend.config import settings


PRESET_TOPICS = [
    {
        "key": "java",
        "name": "Java",
        "icon": "Cpu",
        "dir": "01_Java",
        "readme": dedent(
            """\
            # Java

            ## 最常考什么
            - 集合框架、泛型、并发、JVM、异常处理、IO/NIO、反射、注解。
            - 面试通常不会只问 API 用法，而是追到实现机制、线程安全和性能影响。

            ## 常见追问路径
            - `HashMap`、`ConcurrentHashMap`、`ArrayList`、`LinkedList` 的差异和适用场景。
            - `synchronized`、`volatile`、`Lock`、CAS、线程池的边界和坑。
            - 类加载、内存模型、GC 行为如何影响线上性能和稳定性。

            ## 核心知识边界
            ### 1. 语言基础与面向对象
            - 值传递、重载/重写、接口与抽象类、访问控制、异常体系。

            ### 2. 集合与泛型
            - 常见集合底层结构、扩容机制、遍历方式、泛型擦除。

            ### 3. 并发编程
            - Java 内存模型、可见性/有序性、锁、线程池、并发容器。

            ### 4. JVM
            - 运行时内存区域、类加载流程、垃圾回收、常见调优思路。

            ### 5. IO 与反射
            - BIO/NIO 基础、序列化、反射与注解的使用边界。
            """
        ),
    },
    {
        "key": "python",
        "name": "Python",
        "icon": "Terminal",
        "dir": "02_Python",
        "readme": dedent(
            """\
            # Python

            ## 最常考什么
            - 装饰器、生成器、迭代器、闭包、协程、GIL、常见容器、内存管理。
            - 题目重点是语言机制理解，而不是背语法糖。

            ## 常见追问路径
            - `list`、`dict`、`set` 的特性和底层行为。
            - 生成器和协程怎么工作，适合解决什么问题。
            - 多线程为什么受 GIL 影响，多进程和异步各适合什么场景。

            ## 核心知识边界
            ### 1. 数据模型
            - 可变/不可变对象、引用计数、作用域、对象与类。

            ### 2. 函数能力
            - 闭包、装饰器、上下文管理器、参数传递、异常处理。

            ### 3. 迭代与异步
            - 迭代器、生成器、`yield`、协程、事件循环。

            ### 4. 并发模型
            - GIL、多线程、多进程、异步 IO 的差异与取舍。

            ### 5. 工程实践
            - 包管理、虚拟环境、日志、性能排查、代码组织。
            """
        ),
    },
    {
        "key": "javascript",
        "name": "JavaScript",
        "icon": "Zap",
        "dir": "03_JavaScript",
        "readme": dedent(
            """\
            # JavaScript

            ## 最常考什么
            - 作用域、闭包、原型链、`this`、事件循环、Promise、模块化。
            - 浏览器和 Node 场景下的运行机制题都很高频。

            ## 常见追问路径
            - 代码为什么按这个顺序输出，微任务和宏任务怎么排。
            - 原型继承、对象模型、`new`、`bind/call/apply` 的本质。
            - `Promise`、`async/await` 的错误传播和并发控制。

            ## 核心知识边界
            ### 1. 语言基础
            - 类型系统、类型转换、作用域、闭包、执行上下文。

            ### 2. 对象模型
            - 原型链、继承、`this` 绑定规则、对象创建过程。

            ### 3. 异步机制
            - 事件循环、任务队列、Promise 链、`async/await`。

            ### 4. 模块与运行时
            - CommonJS、ESM、浏览器与 Node 的差异。

            ### 5. 常见陷阱
            - 隐式转换、闭包误用、异步竞态、内存泄漏。
            """
        ),
    },
    {
        "key": "go",
        "name": "Go",
        "icon": "Rocket",
        "dir": "04_Go",
        "readme": dedent(
            """\
            # Go

            ## 最常考什么
            - `slice`、`map`、`channel`、`goroutine`、`interface`、`context`、`defer`、GC。
            - 面试重点通常是并发模型和服务端工程能力。

            ## 常见追问路径
            - `slice` 扩容、共享底层数组、拷贝语义。
            - `channel` 和 `goroutine` 如何协作，阻塞和泄漏怎么出现。
            - `context`、超时、取消、错误处理如何串起一次请求链路。

            ## 核心知识边界
            ### 1. 类型与语法
            - 指针、结构体、方法、接口、组合优于继承。

            ### 2. 核心数据结构
            - `slice`、`map`、`channel` 的行为和边界。

            ### 3. 并发模型
            - goroutine 调度、channel 模式、锁、并发安全。

            ### 4. 控制流与错误处理
            - `defer`、`panic/recover`、显式错误返回。

            ### 5. 性能基础
            - GC、逃逸分析、内存分配、常见 profiling 思路。
            """
        ),
    },
    {
        "key": "algorithms",
        "name": "数据结构与算法",
        "icon": "Code",
        "dir": "05_Algorithms",
        "readme": dedent(
            """\
            # 数据结构与算法

            ## 最常考什么
            - 数组、链表、栈、队列、哈希表、树、堆、图、排序、二分、DFS/BFS、动态规划。
            - 不只考能不能写出来，更考复杂度分析和建模能力。

            ## 常见追问路径
            - 为什么选这个数据结构，能不能更快或更省空间。
            - 递归和迭代如何转换，边界条件怎么处理。
            - 一道题能否抽象成滑窗、双指针、回溯、DP、贪心等通用模型。

            ## 核心知识边界
            ### 1. 复杂度
            - 时间复杂度、空间复杂度、均摊分析。

            ### 2. 基础结构
            - 线性结构、哈希结构、树、堆、图的典型操作。

            ### 3. 经典算法
            - 排序、查找、遍历、最短路径、拓扑排序。

            ### 4. 常见题型
            - 双指针、滑动窗口、递归回溯、贪心、动态规划。

            ### 5. 面试表达
            - 先讲思路，再讲复杂度，再讲边界和优化。
            """
        ),
    },
    {
        "key": "sql",
        "name": "SQL",
        "icon": "Database",
        "dir": "06_SQL",
        "readme": dedent(
            """\
            # SQL

            ## 最常考什么
            - `join`、聚合、子查询、窗口函数、索引、事务、锁、分页、执行计划。
            - 面试常把“SQL 写法”和“数据库性能/并发”连在一起追问。

            ## 常见追问路径
            - 这条 SQL 为什么慢，索引为什么没有生效。
            - 不同 `join`、聚合、排序、分页的代价差异。
            - 事务隔离级别、幻读、死锁、锁范围怎么理解。

            ## 核心知识边界
            ### 1. 查询基础
            - 过滤、排序、分组、聚合、连接、子查询。

            ### 2. 高级查询
            - 窗口函数、CTE、去重、统计口径。

            ### 3. 索引与执行计划
            - 索引结构、覆盖索引、最左前缀、回表、Explain。

            ### 4. 事务与并发
            - ACID、隔离级别、锁、MVCC、死锁。

            ### 5. 优化思路
            - SQL 改写、索引设计、分页策略、冷热数据处理。
            """
        ),
    },
    {
        "key": "react",
        "name": "React",
        "icon": "Blocks",
        "dir": "07_React",
        "readme": dedent(
            """\
            # React

            ## 最常考什么
            - 组件通信、状态管理、Hooks、`useEffect`、渲染机制、`key`、性能优化。
            - 面试经常会从“能写页面”追到“为什么会这样渲染”。

            ## 常见追问路径
            - `useEffect` 为什么会重复执行，依赖数组和闭包有什么坑。
            - 状态更新为什么异步，渲染和提交阶段怎么区分。
            - 如何避免无效渲染、状态错位和组件副作用失控。

            ## 核心知识边界
            ### 1. 组件基础
            - JSX、Props、State、受控组件、条件渲染、列表渲染。

            ### 2. Hooks
            - `useState`、`useEffect`、`useRef`、`useContext` 的职责边界。

            ### 3. 渲染机制
            - 组件重新渲染触发条件、`key`、协调过程、批量更新。

            ### 4. 状态管理
            - 本地状态、Context、状态提升、共享状态拆分。

            ### 5. 工程实践
            - 组件设计、性能定位、请求与副作用管理、表单处理。
            """
        ),
    },
    {
        "key": "spring",
        "name": "Spring",
        "icon": "Layers",
        "dir": "08_Spring",
        "readme": dedent(
            """\
            # Spring

            ## 最常考什么
            - IoC、AOP、Bean 生命周期、事务、MVC、自动装配、代理机制。
            - 常见问法不是“会不会配注解”，而是“框架底层怎么工作”。

            ## 常见追问路径
            - 依赖注入怎么完成，Bean 是何时创建和管理的。
            - AOP 和事务为什么基于代理，事务为什么会失效。
            - Spring Boot 自动配置如何生效，请求是如何进入控制器的。

            ## 核心知识边界
            ### 1. IoC 容器
            - BeanDefinition、依赖注入、生命周期、作用域。

            ### 2. AOP 与代理
            - 动态代理、切面、增强、事务拦截。

            ### 3. Web 基础
            - Spring MVC 请求处理流程、参数绑定、异常处理。

            ### 4. 事务
            - 传播行为、隔离级别、回滚规则、失效场景。

            ### 5. Boot 生态
            - 自动配置、Starter、配置绑定、常见整合方式。
            """
        ),
    },
    {
        "key": "rag",
        "name": "RAG",
        "icon": "Library",
        "dir": "09_RAG",
        "readme": dedent(
            """\
            # RAG

            ## 最常考什么
            - 文档切分、Embedding、向量检索、混合检索、重排、上下文拼装、效果评估。
            - 重点是“为什么召回不到”和“为什么回答不稳”。

            ## 常见追问路径
            - chunk 怎么切，切太大或太小分别会出什么问题。
            - 向量召回、关键词召回、重排各解决什么问题。
            - 怎么控制幻觉、上下文长度、时效性和成本。

            ## 核心知识边界
            ### 1. 基本链路
            - 数据清洗、切分、索引、召回、重排、生成、引用返回。

            ### 2. 检索策略
            - 向量检索、BM25、混合检索、过滤、查询改写。

            ### 3. 上下文构造
            - chunk 选择、去重、排序、模板约束、引用策略。

            ### 4. 质量评估
            - 召回率、相关性、答案正确性、延迟、成本。

            ### 5. 生产问题
            - 数据更新、缓存、权限隔离、观测与回溯。
            """
        ),
    },
    {
        "key": "agent",
        "name": "Agent",
        "icon": "Bot",
        "dir": "10_Agent",
        "readme": dedent(
            """\
            # Agent

            ## 最常考什么
            - 工具调用、任务规划、状态管理、记忆、工作流、重试、护栏、评估。
            - 面试最常追问的是“为什么要用 Agent，而不是普通 workflow”。

            ## 常见追问路径
            - 单 Agent、多 Agent、工作流编排分别适合什么问题。
            - 工具调用如何控制权限、失败重试和幂等性。
            - 记忆该存什么、不该存什么，如何避免上下文污染。

            ## 核心知识边界
            ### 1. 基本概念
            - Agent 与 workflow、tool calling、planner/executor 的区别。

            ### 2. 工具与执行
            - 工具描述、参数校验、执行反馈、错误恢复。

            ### 3. 状态与记忆
            - 短期状态、长期记忆、检索记忆、总结记忆。

            ### 4. 安全与控制
            - 权限边界、人类介入、护栏、审计、成本控制。

            ### 5. 评估与观测
            - 成功率、任务完成度、轨迹分析、失败分类。
            """
        ),
    },
    {
        "key": "middleware_distributed",
        "name": "中间件与分布式",
        "icon": "Network",
        "dir": "11_Middleware_Distributed",
        "readme": dedent(
            """\
            # 中间件与分布式

            ## 最常考什么
            - Redis、消息队列、分布式锁、缓存一致性、限流、熔断、CAP、幂等、分布式事务。
            - 面试通常围绕“高并发、高可用、一致性”展开。

            ## 常见追问路径
            - 缓存穿透、击穿、雪崩怎么处理，为什么这样处理。
            - MQ 为什么要引入，重复消费、顺序消费、消息丢失怎么解决。
            - 分布式系统里如何做幂等、降级、隔离、重试和故障恢复。

            ## 核心知识边界
            ### 1. 缓存
            - Redis 基础数据结构、过期策略、淘汰策略、缓存一致性。

            ### 2. 消息队列
            - 生产消费模型、削峰填谷、顺序、重试、死信、幂等。

            ### 3. 分布式基础
            - CAP、BASE、复制、选主、故障转移、脑裂。

            ### 4. 高可用治理
            - 限流、熔断、降级、隔离、超时、重试。

            ### 5. 一致性问题
            - 分布式锁、事务、最终一致性、补偿机制。
            """
        ),
    },
    {
        "key": "microservices",
        "name": "微服务",
        "icon": "Workflow",
        "dir": "12_Microservices",
        "readme": dedent(
            """\
            # 微服务

            ## 最常考什么
            - 服务拆分、注册发现、配置中心、网关、调用链、容错、部署发布、数据一致性。
            - 重点不在名词堆砌，而在“为什么拆、怎么拆、拆完怎么治理”。

            ## 常见追问路径
            - 单体为什么要拆，按什么边界拆，拆过度会出什么问题。
            - 服务间调用如何做超时、重试、熔断、限流、链路追踪。
            - 微服务后的数据一致性、部署复杂度、排障成本如何控制。

            ## 核心知识边界
            ### 1. 拆分原则
            - 业务边界、团队边界、数据边界、演进式拆分。

            ### 2. 基础设施
            - 注册发现、配置管理、API 网关、服务通信。

            ### 3. 服务治理
            - 负载均衡、熔断、重试、限流、降级、可观测性。

            ### 4. 数据与事务
            - 分库分表、服务间数据边界、最终一致性、Saga/补偿。

            ### 5. 交付与运维
            - 灰度发布、回滚、日志、指标、链路追踪、故障排查。
            """
        ),
    },
]


def _read_json(path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _state_path(user_id: str):
    return settings.user_data_dir(user_id) / ".preset_topics_state.json"


def _should_seed_readme(readme_path, topic_name: str) -> bool:
    if not readme_path.exists():
        return True

    content = readme_path.read_text(encoding="utf-8").strip()
    return content in {"", f"# {topic_name}"}


def ensure_preset_topics(user_id: str):
    topics_path = settings.user_topics_path(user_id)
    topics = _read_json(topics_path, {})
    state = _read_json(_state_path(user_id), {"seeded_keys": []})
    seeded_keys = set(state.get("seeded_keys", []))

    topics_changed = False
    state_changed = False

    for preset in PRESET_TOPICS:
        key = preset["key"]
        existing = topics.get(key)

        if key not in seeded_keys and existing is None:
            existing = {
                "name": preset["name"],
                "icon": preset["icon"],
                "dir": preset["dir"],
            }
            topics[key] = existing
            topics_changed = True

        if key not in seeded_keys:
            topic_meta = existing or {
                "name": preset["name"],
                "icon": preset["icon"],
                "dir": preset["dir"],
            }
            topic_dir = settings.user_knowledge_path(user_id) / topic_meta["dir"]
            topic_dir.mkdir(parents=True, exist_ok=True)
            readme_path = topic_dir / "README.md"

            if _should_seed_readme(readme_path, topic_meta.get("name") or preset["name"]):
                readme_path.write_text(preset["readme"], encoding="utf-8")

            seeded_keys.add(key)
            state_changed = True

    if topics_changed:
        _write_json(topics_path, topics)
    if state_changed:
        _write_json(_state_path(user_id), {"seeded_keys": sorted(seeded_keys)})
