import {
  computed, defineComponent, ref, watch, toRefs, onMounted, nextTick,
} from '@vue/composition-api';
import debounce from 'lodash/debounce';
import range from 'lodash/range';
import padStart from 'lodash/padStart';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

import { panelColProps } from './props';
import {
  EPickerCols, TWELVE_HOUR_FORMAT, AM, PM, MERIDIEM_LIST,
} from '../../_common/js/time-picker/const';
import { closestLookup } from '../../_common/js/time-picker/utils';
import { useConfig } from '../../hooks/useConfig';

dayjs.extend(customParseFormat);

const timeArr = [EPickerCols.hour, EPickerCols.minute, EPickerCols.second, EPickerCols.milliSecond];

const panelOffset = {
  top: 15,
  bottom: 21,
};

export const REGEX_FORMAT = /\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g;

export default defineComponent({
  name: 'TTimePickerPanelCol',
  props: {
    ...panelColProps(),
    position: String,
    triggerScroll: Boolean,
    onChange: Function,
    resetTriggerScroll: Function,
    disableTime: Function,
    isShowPanel: Boolean,
  },
  setup(props, ctx) {
    const {
      steps, value, format, position, triggerScroll,
    } = toRefs(props);

    const { global } = useConfig('timePicker');

    const { classPrefix } = useConfig();

    const cols = ref<Array<EPickerCols>>([]);
    const bodyRef = ref();
    const maskRef = ref(null);

    const dayjsValue = computed(() => {
      const isStepsSet = !!steps.value.filter((v: number) => v > 1).length;

      if (value.value) return dayjs(value.value, format.value);

      if (isStepsSet) return dayjs().hour(0).minute(0).second(0);
      return dayjs();
    });

    const panelClassName = computed(() => `${classPrefix.value}-time-picker__panel`);

    // 面板打开时 触发滚动 初始化面板
    watch(
      () => dayjsValue.value,
      () => {
        if (dayjsValue.value && value.value) updateTimeScrollPos(true);
      },
    );

    // 时间通过外部触发时 同样触发滚动
    watch(
      () => triggerScroll.value,
      () => {
        if (triggerScroll.value) {
          updateTimeScrollPos(true);
        }
      },
    );

    onMounted(() => {
      const match = format.value.match(REGEX_FORMAT);
      const {
        meridiem, hour, minute, second, milliSecond,
      } = EPickerCols;

      const renderCol: EPickerCols[] = [];

      match.forEach((m) => {
        switch (m) {
          case 'H':
          case 'HH':
          case 'h':
          case 'hh':
            renderCol.push(hour);
            break;
          case 'a':
          case 'A':
            renderCol.push(meridiem);
            break;
          case 'm':
          case 'mm':
            renderCol.push(minute);
            break;
          case 's':
          case 'ss':
            renderCol.push(second);
            break;
          case 'SSS':
            renderCol.push(milliSecond);
            break;
          default:
            break;
        }
      });
      cols.value = renderCol;
    });

    // 获取每个时间的高度
    const getItemHeight = () => {
      const maskDom = maskRef.value?.querySelector('div');

      if (!maskDom) {
        return {
          offsetHeight: 0,
          margin: 0,
        };
      }
      return {
        offsetHeight: maskDom.offsetHeight,
        margin: parseInt(getComputedStyle(maskDom).marginTop, 10),
      };
    };

    const timeItemCanUsed = (col: EPickerCols, el: string | number) => {
      const colIdx = timeArr.indexOf(col);
      if (colIdx !== -1) {
        const params: [number, number, number] = [
          dayjsValue.value.hour(),
          dayjsValue.value.minute(),
          dayjsValue.value.second(),
        ];
        params[colIdx] = Number(el);
        return !props.disableTime?.(...params, { partial: position.value || 'start' })?.[col]?.includes(Number(el));
      }
      return true;
    };

    // 获取需要渲染的column
    const getColList = (col: EPickerCols) => {
      let count = 0;

      if (timeArr.includes(col)) {
        // hour、minute and second columns
        const colIdx = timeArr.indexOf(col);
        const colStep = steps.value[colIdx] || 1;

        if (col === EPickerCols.hour) count = TWELVE_HOUR_FORMAT.test(format.value) ? 11 : 23; // 小时最大为23 12小时制最大为11
        else if (col === EPickerCols.milliSecond) count = 999; // 毫秒最大为999
        else count = 59;

        const colList = range(0, count + 1, Number(colStep)).map((v) => padStart(String(v), 2, '0')) || [];

        return props.hideDisabledTime && !!props.disableTime
          ? colList.filter((t) => {
            const params: [number, number, number, number] = [
              dayjsValue.value.hour(),
              dayjsValue.value.minute(),
              dayjsValue.value.second(),
              dayjsValue.value.millisecond(),
            ];
            params[colIdx] = Number(t);
            return !props
              .disableTime?.(...params, { partial: position.value || 'start' })
              ?.[col]?.includes(Number(t));
          })
          : colList;
      }
      // meridiem column
      return MERIDIEM_LIST;
    };

    const getScrollDistance = (col: EPickerCols, time: number | string) => {
      if (col === EPickerCols.hour && /[h]{1}/.test(format.value)) {
        // eslint-disable-next-line no-param-reassign
        (time as number) %= 12;
      } // 一定是数字，直接cast

      const itemIdx = getColList(col).indexOf(padStart(String(time), 2, '0'));
      const { offsetHeight, margin } = getItemHeight();
      const timeItemTotalHeight = offsetHeight + margin;
      const distance = Math.abs(Math.max(0, itemIdx) * timeItemTotalHeight);
      return distance;
    };

    const handleScroll = (col: EPickerCols, e: MouseEvent) => {
      let val: number | string;
      let formattedVal: string;
      if (!props.isShowPanel) return;

      const scrollTop = (ctx.refs as any)[`${col}Col`]?.scrollTop + panelOffset.top;

      const { offsetHeight, margin } = getItemHeight();
      const timeItemTotalHeight = offsetHeight + margin;
      let colStep = Math.abs(Math.round(scrollTop / timeItemTotalHeight + 0.5));
      const meridiem = MERIDIEM_LIST[Math.min(colStep - 1, 1)].toLowerCase(); // 处理PM、AM与am、pm

      if (Number.isNaN(colStep)) colStep = 1;
      if (timeArr.includes(col)) {
        // hour、minute、 second and milliSecond
        let max = 59;
        if (col === EPickerCols.hour) max = /[h]{1}/.test(format.value) ? 11 : 23; // 小时最大为23 12小时制最大为11
        else if (col === EPickerCols.milliSecond) max = 999; // 毫秒最大为999

        const colIdx = timeArr.indexOf(col);
        const availableArr = range(0, max + 1, Number(steps.value[colIdx]) || 1);
        val = closestLookup(
          availableArr,
          Number(getColList(col)[Math.min(colStep - 1, max + 1, availableArr.length - 1)]),
          Number(steps.value[colIdx]) || 1,
        );
        if (Number.isNaN(val)) val = availableArr[availableArr.length - 1];
        if (col === EPickerCols.hour && cols.value.includes(EPickerCols.meridiem) && dayjsValue.value.hour() >= 12) {
          // 如果是十二小时制需要再判断
          val = Number(val) + 12;
        }
      } else val = meridiem;

      const distance = getScrollDistance(col, val);

      if (!dayjs(dayjsValue.value).isValid() || (value.value && !dayjs(value.value, format.value, true).isValid())) return;

      if (timeArr.includes(col)) {
        if (timeItemCanUsed(col, val)) {
          formattedVal = dayjsValue.value[col]?.(val).format(format.value);
        } else {
          formattedVal = dayjsValue.value.format(format.value);
        }
      } else {
        const currentHour = dayjsValue.value.hour();
        if (meridiem === AM && currentHour >= 12) {
          formattedVal = dayjsValue.value.hour(currentHour - 12).format(format.value);
        } else if (meridiem === PM && currentHour < 12) {
          formattedVal = dayjsValue.value.hour(currentHour + 12).format(format.value);
        } else {
          formattedVal = dayjsValue.value.format(format.value);
        }
      }
      if (formattedVal !== value.value) props.onChange?.(formattedVal, e);
      if (distance !== scrollTop) {
        const scrollCtrl = (ctx.refs as any)[`${col}Col`];

        if (!scrollCtrl || scrollCtrl.scrollTop === distance) return;

        scrollCtrl.scrollTo?.({
          top: distance,
          behavior: 'smooth',
        });
      }
    };

    const scrollToTime = (
      col: EPickerCols,
      time: number | string,
      idx: number,
      behavior: 'auto' | 'smooth' = 'auto',
    ) => {
      const distance = getScrollDistance(col, time);
      const scrollCtrl = (ctx.refs as any)[`${col}Col`];

      if (!scrollCtrl || scrollCtrl.scrollTop === distance || !timeItemCanUsed(col, time)) return;
      scrollCtrl.scrollTo?.({
        top: distance,
        behavior,
      });
    };

    const handleTimeItemClick = (col: EPickerCols, el: string | number, idx: number, e: MouseEvent) => {
      if (!timeItemCanUsed(col, el)) return;
      if (timeArr.includes(col)) {
        if (
          col === EPickerCols.hour
          && dayjsValue.value.format('a') === PM
          && cols.value.includes(EPickerCols.meridiem)
        ) {
          // eslint-disable-next-line no-param-reassign
          el = Number(el) + 12;
        }
        scrollToTime(col, el, idx, 'smooth');
      } else {
        const currentHour = dayjsValue.value.hour();
        if (el === AM && currentHour >= 12) {
          props.onChange?.(dayjsValue.value.hour(currentHour - 12).format(format.value), e);
        } else if (el === PM && currentHour < 12) {
          props.onChange?.(dayjsValue.value.hour(currentHour + 12).format(format.value), e);
        }
      }
    };

    // update each columns scroll distance
    const updateTimeScrollPos = (isAutoScroll = false) => {
      const behavior = value.value && !isAutoScroll ? 'smooth' : 'auto';
      const isStepsSet = !!steps.value.filter((v) => v > 1).length;

      nextTick(() => {
        cols.value.forEach((col: EPickerCols, idx: number) => {
          if (!isStepsSet || (isStepsSet && value.value)) {
            // 如果没有设置大于1的steps或设置了大于1的step 正常处理滚动
            scrollToTime(
              col,
              timeArr.includes(col) ? dayjsValue.value[col]?.() : dayjsValue.value.format('a'),
              idx,
              behavior,
            );
          } else {
            // 否则初始化到每列第一个选项
            scrollToTime(col, getColList(col)?.[0], idx, behavior);
          }
        });
      });

      props.resetTriggerScroll();
    };

    const isCurrent = (col: EPickerCols, colItem: string | number) => {
      let colVal: number;
      if (col === EPickerCols.meridiem) {
        const currentMeridiem = dayjsValue.value.format('a');
        return currentMeridiem === colItem;
      }
      colVal = dayjsValue.value[col]?.();
      if (col === EPickerCols.hour && /[h]{1}/.test(format.value)) {
        colVal %= 12;
      }
      return colVal === Number(colItem);
    };

    return {
      getColList,
      isCurrent,
      bodyRef,
      maskRef,
      global,
      classPrefix,
      panelClassName,
      cols,
      timeItemCanUsed,
      handleScroll,
      handleTimeItemClick,
    };
  },
  render() {
    return (
      <div class={`${this.panelClassName}-body`} ref="bodyRef">
        <div class={`${this.panelClassName}-body-active-mask`} ref="maskRef">
          {/* 渲染遮罩层 */}
          {this.cols.map?.((col, idx) => (
            <div key={`${col}_${idx}`} />
          ))}
        </div>
        {/* 渲染实际滚动列 */}
        {this.cols.map?.((col, idx) => (
          <ul
            key={`${col}_${idx}`}
            ref={`${col}Col`}
            class={`${this.panelClassName}-body-scroll`}
            onScroll={debounce((e) => this.handleScroll(col, e), 50)}
          >
            {this.getColList(col).map((el) => (
              <li
                key={el}
                class={[
                  `${this.panelClassName}-body-scroll-item`,
                  {
                    [`${this.classPrefix}-is-disabled`]: !this.timeItemCanUsed(col, el),
                    [`${this.classPrefix}-is-current`]: this.isCurrent(col, el),
                  },
                ]}
                onClick={(e: MouseEvent) => this.handleTimeItemClick(col, el, idx, e)}
              >
                {/* eslint-disable-next-line no-nested-ternary */}
                {timeArr.includes(col)
                  ? TWELVE_HOUR_FORMAT.test(this.format) && col === EPickerCols.hour && el === '00'
                    ? '12'
                    : el
                  : this.global[el === AM ? 'anteMeridiem' : 'postMeridiem']}
              </li>
            ))}
          </ul>
        ))}
      </div>
    );
  },
});
