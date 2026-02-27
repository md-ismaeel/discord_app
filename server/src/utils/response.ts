import { HTTP_STATUS } from "../constants/httpStatus.js";

export const sendSuccess = (res, data, message = "Success") => {
    return res.status(HTTP_STATUS.OK).json({
        success: true,
        message,
        data,
    });
};

export const sendCreated = (res, data, message = "Created successfully") => {
    return res.status(HTTP_STATUS.CREATED).json({
        success: true,
        message,
        data,
    });
};

export const sendBadRequest = (res, message, errors = null) => {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        message,
        errors,
    });
};


export const sendConflict = (res, message) => {
    return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        message,
    });
};

export const sendError = (res, message, statusCode, errors) => {
    return res.status(statusCode).json({
        success: false,
        message,
        errors,
    })
}