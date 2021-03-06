/* @flow */

import {
  warn,
  remove,
  isObject,
  parsePath,
  _Set as Set,
  handleError,
  noop
} from '../util/index'

import { traverse } from './traverse'
import { queueWatcher } from './scheduler'
import Dep, { pushTarget, popTarget } from './dep'

import type { SimpleSet } from '../util/index'

let uid = 0

/**
 * A watcher parses an expression, collects dependencies,
 * and fires callback when the expression value changes.
 * This is used for both the $watch() api and directives.
 */
export default class Watcher {
  vm: Component;
  expression: string;
  cb: Function;
  id: number;
  deep: boolean;
  user: boolean;
  lazy: boolean;
  sync: boolean;
  dirty: boolean;
  active: boolean;
  deps: Array<Dep>;
  newDeps: Array<Dep>;
  depIds: SimpleSet;
  newDepIds: SimpleSet;
  before: ?Function;
  getter: Function;
  value: any;

  constructor (
    vm: Component,                        // 组件实例对象 vm
    expOrFn: string | Function,           // 要观察的表达式 expOrFn，如监听的'a'属性。 函数的作用 主要就是 把渲染函数生成的虚拟DOM渲染成真正的DOM。重要的是“被观测目标”能否触发数据属性的 get 拦截器函数
    cb: Function,                         // 当被观察的表达式的值变化时的回调函数 cb
    options?: ?Object,                    // 一些传递给当前观察者对象的选项 options
    isRenderWatcher?: boolean             // 以及一个布尔值 isRenderWatcher 用来标识该观察者实例是否是渲染函数的观察者，只有在mountComponent函数中创建渲染函数观察者时这个参数为真
  ) {
    /*
      1.将当前组件实例对象赋值给该观察者实例的 this.vm 属性，每一个观察者实例对象都有一个vm实例属性，该属性指明了这个观察者是属于哪一个组件的
      2. 只有在 mountComponent 函数中创建渲染函数观察者时这个参数为真，则会将当前观察者实例赋值给 vm._watcher 属性。也就是说组件实例的 _watcher 属性的值引用着该组件的渲染函数观察者
      3. 该组件实例的观察者都会被添加到该组件实例对象的 vm._watchers 数组中，包括渲染函数的观察者和非渲染函数的观察者
     */
    this.vm = vm
    if (isRenderWatcher) {
      vm._watcher = this
    }
    // vm._watchers中存储着该组件所有的观察者实例对象，即（渲染函数观察者对象、计算属性观察者对象、自定义观察者对象）
    vm._watchers.push(this)

    // options
    if (options) {
      //options.deep，用来告诉当前观察者实例对象是否是深度观测
      this.deep = !!options.deep
      //options.user，用来标识当前观察者实例对象是 开发者定义的 还是 内部定义的
      //除了内部定义的观察者(如：渲染函数的观察者、计算属性的观察者等)之外，所有观察者都被认为是开发者定义的，这时 options.user 会自动被设置为 true。
      this.user = !!options.user
      // true 表示是一个计算属性的观察者对象，false表示非计算属性的观察者
      this.lazy = !!options.lazy
      // options.sync，用来告诉观察者当数据变化时是否同步求值并执行回调
      this.sync = !!options.sync
      // options.before，可以理解为 Watcher 实例的钩子，当数据变化之后，触发更新之前，调用在创建渲染函数的观察者实例对象时传递的 before 选项
      this.before = options.before
    } else {
      this.deep = this.user = this.lazy = this.sync = false
    }

    this.cb = cb
    this.id = ++uid // uid for batching
    this.active = true
    this.dirty = this.lazy // for lazy watchers

    //那么这两组属性的作用是什么呢？其实它们就是传说中用来实现避免收集重复依赖，且移除无用依赖的功能也依赖于它们
    this.deps = []
    this.depIds = new Set()
    this.newDeps = []
    this.newDepIds = new Set()

    this.expression = process.env.NODE_ENV !== 'production'
      ? expOrFn.toString()
      : ''

    // parse expression for getter
    if (typeof expOrFn === 'function') {
      this.getter = expOrFn
    } else {
      this.getter = parsePath(expOrFn)
      if (!this.getter) {
        this.getter = noop
        process.env.NODE_ENV !== 'production' && warn(
          `Failed watching path: "${expOrFn}" ` +
          'Watcher only accepts simple dot-delimited paths. ' +
          'For full control, use a function instead.',
          vm
        )
      }
    }
    this.value = this.lazy
      ? undefined
      : this.get()
  }

  /**
   * Evaluate the getter, and re-collect dependencies.
   * 该函数的作用：求值
   * 求值的目的有两个，第一个是能够触发访问器属性的 get 拦截器函数(其中触发该函数是依赖被收集的关键)，第二个是能够获得被观察目标的值。
   * @return 返回的是被观察目标的值， 如'a.b'的值
   */
  get () {
    /*
    其实 pushTarget 函数的作用就是用来为 Dep.target 属性赋值的，pushTarget 函数会将接收到的参数赋值给 Dep.target 属性，
    我们知道传递给 pushTarget 函数的参数就是调用该函数的观察者对象，所以 Dep.target 保存着一个观察者对象，其实这个观察者对象就是即将要收集的目标
     */
    pushTarget(this)

    let value
    const vm = this.vm
    try {
      value = this.getter.call(vm, vm)
    } catch (e) {
      if (this.user) {
        handleError(e, vm, `getter for watcher "${this.expression}"`)
      } else {
        throw e
      }
    } finally {
      // "touch" every property so they are all tracked as
      // dependencies for deep watching
      // 深度观测
      if (this.deep) {
        // traverse 函数的作用就是递归地读取被观察属性的所有子属性的值，这样被观察属性的所有子属性都将会触发 getter 收集到观察者，从而达到深度观测的目的
        traverse(value)
      }
      popTarget()
      this.cleanupDeps()
    }
    return value
  }

  /**
   * Add a dependency to this directive.
   */
  addDep (dep: Dep) {
    const id = dep.id
    if (!this.newDepIds.has(id)) {
      this.newDepIds.add(id)
      this.newDeps.push(dep)
      if (!this.depIds.has(id)) {
        dep.addSub(this)
      }
    }
  }

  /**
   * Clean up for dependency collection.
   */
  cleanupDeps () {
    let i = this.deps.length
    while (i--) {
      const dep = this.deps[i]
      if (!this.newDepIds.has(dep.id)) {
        dep.removeSub(this)
      }
    }
    let tmp = this.depIds
    this.depIds = this.newDepIds
    this.newDepIds = tmp
    this.newDepIds.clear()
    tmp = this.deps
    this.deps = this.newDeps
    this.newDeps = tmp
    this.newDeps.length = 0
  }

  /**
   * Subscriber interface.
   * Will be called when a dependency changes.
   */
  update () {
    /* istanbul ignore else */
    if (this.lazy) {
      this.dirty = true
    } else if (this.sync) {
      this.run()
    } else {
      // queueWatcher函数的作用：它将观察者放到一个队列中等待所有突变完成之后统一执行更新
      queueWatcher(this)
    }
  }

  /**
   * Scheduler job interface.
   * Will be called by the scheduler.
   */
  run () {
    //this.active 用来标识一个观察者是否处于激活状态，或可用状态。
    if (this.active) {
      //对于setter后， 重新求值
      const value = this.get()
      //该判断对于渲染函数的观察者来讲并不会执行这个if，因为updateComponent 函数返回的永远是undefined。实际上if语句块内的代码是为非渲染函数类型的观察者准备的。
      //注意：value !== this.value || isObject(value)  可以是一个对象的情况，并且 value 和 this.value是引用传值，所以value === this.value
      if (
        value !== this.value ||
        // Deep watchers and watchers on Object/Arrays should fire even
        // when the value is the same, because the value may
        // have mutated.
        isObject(value) ||
        this.deep
      ) {
        // set new value
        const oldValue = this.value
        this.value = value
        // 如果观察者对象的 this.user 为真意味着这个观察者是开发者定义的
        if (this.user) {
          // 开发者自己定义的回调，特点是回调函数是由开发者编写的，所以这些回调函数在执行的过程中其行为是不可预知的，很可能出现错误，这时候将其放到一个 try...catch 语句块中
          try {
            this.cb.call(this.vm, value, oldValue)
          } catch (e) {
            handleError(e, this.vm, `callback for watcher "${this.expression}"`)
          }
        } else {
          this.cb.call(this.vm, value, oldValue)
        }
      }
    }
  }

  /**
   * Evaluate the value of the watcher.
   * This only gets called for lazy watchers.
   *  用于惰性观察者，如计算属性
   */
  evaluate () {
    this.value = this.get()
    this.dirty = false
  }

  /**
   * Depend on all deps collected by this watcher.
   */
  depend () {
    let i = this.deps.length
    while (i--) {
      this.deps[i].depend()
    }
  }

  /**
   * Remove self from all dependencies' subscriber list.
   */
  teardown () {
    // this.active 属性是否为真，如果为假则说明该观察者已经不处于激活状态，什么都不需要做
    if (this.active) {
      // remove self from vm's watcher list
      // this is a somewhat expensive operation so we skip it
      // if the vm is being destroyed.
      // 每个组件实例都有一个 vm._isBeingDestroyed 属性，它是一个标识，为真说明该组件实例已经被销毁了，为假说明该组件还没有被销毁
      if (!this.vm._isBeingDestroyed) {
        remove(this.vm._watchers, this)
      }
      let i = this.deps.length
      while (i--) {
        this.deps[i].removeSub(this)
      }
      // 表示该观察者对象已经处于非激活状态了
      this.active = false
    }
  }
}
