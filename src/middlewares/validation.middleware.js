const Joi = require('joi');

const uploadSchema = Joi.object({
});

const statusSchema = Joi.object({
  id: Joi.string().hex().length(24).required()
});

exports.validateId = (req, res, next) => {
  const { error } = statusSchema.validate(req.params);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};
