// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import classNames from 'classnames';
import React, {useState, useEffect} from 'react';
import type {MessageDescriptor} from 'react-intl';
import {useIntl} from 'react-intl';

import {CloseCircleIcon} from '@mattermost/compass-icons/components';

import WithTooltip from 'components/with_tooltip';

import {ItemStatus} from 'utils/constants';
import {formatAsString} from 'utils/i18n';

import './input.scss';

export enum SIZE {
    MEDIUM = 'medium',
    LARGE = 'large',
}

export type CustomMessageInputType = {type?: 'info' | 'error' | 'warning' | 'success'; value: React.ReactNode} | null;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>, 'placeholder'> {
    required?: boolean;
    hasError?: boolean;
    addon?: React.ReactElement;
    textPrefix?: string;
    inputPrefix?: JSX.Element;
    inputSuffix?: JSX.Element;
    label?: string | MessageDescriptor;
    placeholder?: MessageDescriptor | string;
    containerClassName?: string;
    wrapperClassName?: string;
    inputClassName?: string;
    limit?: number;
    minLength?: number;
    useLegend?: boolean;
    customMessage?: CustomMessageInputType;
    inputSize?: SIZE;
    clearable?: boolean;
    clearableTooltipText?: string;
    onClear?: () => void;
    rows?: number;
    validate?: (value: React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement>['value']) => CustomMessageInputType | undefined;
}

const Input = React.forwardRef((
    {
        name,
        value,
        label,
        placeholder,
        useLegend = true,
        className,
        hasError,
        required,
        addon,
        textPrefix,
        inputPrefix,
        inputSuffix,
        containerClassName,
        wrapperClassName,
        inputClassName,
        limit,
        minLength,
        customMessage,
        maxLength,
        inputSize = SIZE.MEDIUM,
        disabled,
        clearable,
        clearableTooltipText,
        onFocus,
        onBlur,
        onChange,
        onClear,
        rows,
        validate,
        ...otherProps
    }: InputProps,
    ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement>,
) => {
    const {formatMessage} = useIntl();

    const [focused, setFocused] = useState(false);
    const [customInputLabel, setCustomInputLabel] = useState<CustomMessageInputType>(null);

    const errorId = `error_${name || ''}`;
    const inputId = `input_${name || ''}`;

    useEffect(() => {
        if (customMessage === undefined || customMessage === null) {
            if (customInputLabel !== null) {
                // edge-use case: a consumer of this component may have its input updated
                // from more than one place, such as by a network fetching data after load
                // in that case, we need to remove the error according to the response
                setCustomInputLabel(customMessage || null);
            }
            return;
        }

        if (customMessage !== undefined && customMessage !== null && Boolean(customMessage.value)) {
            setCustomInputLabel(customMessage);
        }
    }, [customMessage]);

    // Re-validate input when value changes (e.g. when a parent component sets a new value,not just when the user types)
    useEffect(() => {
        // Only run validation if we're not focused (to avoid validating during typing)
        // and if there is currently an error displayed
        if (!focused && customInputLabel?.type === 'error') {
            // Clear error state when value changes
            setCustomInputLabel(null);

            // Re-run validation to check if the new value is valid
            if (value !== undefined && value !== null && value !== '') {
                validateInput();
            }
        }
    }, [value]); // Only run when value changes

    const handleOnFocus = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFocused(true);

        if (onFocus) {
            onFocus(event);
        }
    };

    const handleOnBlur = (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setFocused(false);
        validateInput();

        if (onBlur) {
            onBlur(event);
        }
    };

    const handleOnChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        // Clear custom messages when user types
        setCustomInputLabel(null);

        if (onChange) {
            onChange(event);
        }
    };

    const handleOnClear = () => {
        if (onClear) {
            onClear();
        }
    };

    const validateInput = () => {
        if (validate) {
            const validationError = validate(value);
            if (validationError) {
                setCustomInputLabel(validationError);
                return;
            }
        }

        // Only check for required field validation on blur
        // Length validation is handled through derived values in the render function
        if (required && (value === null || value === '')) {
            const validationErrorMsg = formatMessage({id: 'widget.input.required', defaultMessage: 'This field is required'});
            setCustomInputLabel({type: ItemStatus.ERROR, value: validationErrorMsg});
            return;
        }

        const limitExceeded = limit && value && !Array.isArray(value) ? value.toString().length - limit : 0;
        const minLengthNotMet = minLength && value !== undefined && !Array.isArray(value) ? minLength - value.toString().length : (minLength || 0);

        // Show min length error even when the input is empty (to match existing behavior in tests)
        // Generate derived error messages
        if (limitExceeded > 0) {
            setCustomInputLabel({
                type: ItemStatus.ERROR,
                value: formatMessage(
                    {id: 'widget.input.max_length', defaultMessage: 'Must be no more than {limit} characters'},
                    {limit},
                )});
        } else if (minLengthNotMet > 0) {
            setCustomInputLabel({
                type: ItemStatus.ERROR,
                value: formatMessage(
                    {id: 'widget.input.min_length', defaultMessage: 'Must be at least {minLength} characters'},
                    {minLength},
                ),
            });
        }
    };

    const showLegend = Boolean(focused || value);
    const error = customInputLabel?.type === ItemStatus.ERROR;
    const warning = customInputLabel?.type === ItemStatus.WARNING;

    const clearButton = value && clearable ? (
        <div
            className='Input__clear'
            onMouseDown={handleOnClear}
            onTouchEnd={handleOnClear}
        >
            <WithTooltip
                title={clearableTooltipText || formatMessage({id: 'widget.input.clear', defaultMessage: 'Clear'})}
            >
                <CloseCircleIcon size={18}/>
            </WithTooltip>
        </div>
    ) : null;

    const generateInput = () => {
        const placeholderValue = formatAsString(formatMessage, focused ? (label && placeholder) || label : label || placeholder);
        const ariaLabel = formatAsString(formatMessage, label || placeholder);

        if (otherProps.type === 'textarea') {
            return (
                <textarea
                    ref={ref as React.RefObject<HTMLTextAreaElement>}
                    id={inputId}
                    className={classNames('Input form-control', inputSize, inputClassName, {Input__focus: showLegend})}
                    value={value}
                    placeholder={placeholderValue}
                    aria-label={ariaLabel}
                    aria-describedby={customInputLabel ? errorId : undefined}
                    aria-invalid={error || hasError}
                    rows={rows || 3}
                    name={name}
                    disabled={disabled}
                    {...otherProps}
                    maxLength={limit ? undefined : maxLength}
                    onFocus={handleOnFocus}
                    onBlur={handleOnBlur}
                    onChange={handleOnChange}
                />);
        }
        return (
            <input
                ref={ref as React.RefObject<HTMLInputElement>}
                id={inputId}
                className={classNames('Input form-control', inputSize, inputClassName, {Input__focus: showLegend})}
                value={value}
                placeholder={placeholderValue}
                aria-label={ariaLabel}
                aria-describedby={customInputLabel ? errorId : undefined}
                aria-invalid={error || hasError}
                name={name}
                disabled={disabled}
                {...otherProps}
                maxLength={limit ? undefined : maxLength}
                onFocus={handleOnFocus}
                onBlur={handleOnBlur}
                onChange={handleOnChange}
            />
        );
    };

    return (
        <div className={classNames('Input_container', containerClassName, {disabled})}>
            <div
                className={classNames('Input_fieldset', className, {
                    Input_fieldset___error: hasError || customInputLabel?.type === 'error',
                    Input_fieldset___legend: showLegend,
                })}
                data-testid='input-wrapper'
            >
                {useLegend && (
                    <label
                        htmlFor={inputId}
                        className={classNames('Input_legend', {Input_legend___focus: showLegend})}
                    >                        {showLegend ? formatAsString(formatMessage, label || placeholder) : null}
                    </label>
                )}
                <div className={classNames('Input_wrapper', wrapperClassName)}>
                    {inputPrefix}
                    {textPrefix && <span>{textPrefix}</span>}
                    {generateInput()}
                    {inputSuffix}
                    {clearButton}
                </div>
                {addon}
            </div>
            {/* Display custom or derived error messages */}
            {customInputLabel && (
                <div
                    className={`Input___customMessage Input___${customInputLabel?.type || 'error'}`}
                    id={errorId}
                    role={error || warning ? 'alert' : undefined}
                >
                    <i
                        className={classNames(`icon ${customInputLabel?.type || 'error'}`, {
                            'icon-alert-outline': (customInputLabel?.type || 'error') === ItemStatus.WARNING,
                            'icon-alert-circle-outline': (customInputLabel?.type || 'error') === ItemStatus.ERROR,
                            'icon-information-outline': (customInputLabel?.type || 'error') === ItemStatus.INFO,
                            'icon-check': (customInputLabel?.type || 'error') === ItemStatus.SUCCESS,
                        })}
                        role='img'
                        aria-label={customInputLabel.value ? '' : customInputLabel.type || 'error'}
                        aria-hidden={Boolean(customInputLabel.value)}
                    />
                    <span>{customInputLabel?.value}</span>
                </div>
            )}
        </div>
    );
});

export default Input;
